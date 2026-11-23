"""Server-wide settings (admins) and the map configuration (everyone).

Imagery: Esri (no key) or Google Map Tiles (the admin's API key). The
Google key is stored encrypted, shown to admins only as its last four
characters, and sent to signed-in browsers, which request Google tiles
directly. Restrict the key to this site's address in the Google Cloud
console.
"""

import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from argus import secrets
from argus.api.deps import (
    DbDep,
    SessionDep,
    SettingsDep,
    client_ip,
    require,
)
from argus.db import utcnow
from argus.models import AuditLog, ServerSetting, User, UserSession
from argus.schemas import BriefPrefs
from argus.services import audit

router = APIRouter(tags=["admin"])
log = logging.getLogger("argus.admin")

IMAGERY = "imagery"
GOOGLE_SESSION_URL = "https://tile.googleapis.com/v1/createSession"


AdminDep = Depends(require("settings.manage"))


class ImageryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["esri", "google"]
    # Omit to keep the stored key; "" removes it.
    google_key: str | None = Field(default=None, max_length=200)
    google_3d: bool = False


async def check_google_key(key: str) -> str | None:
    """None if Google accepts the key for Map Tiles, else the reason."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                GOOGLE_SESSION_URL,
                params={"key": key},
                json={"mapType": "satellite", "language": "en-US"},
            )
    except httpx.HTTPError as exc:
        return "Couldn't reach Google ({0}).".format(type(exc).__name__)
    if response.status_code == 200:
        return None
    try:
        message = response.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        message = "HTTP {0}".format(response.status_code)
    return "Google refused the key: {0}".format(message)


async def _imagery(db) -> dict:
    row = await db.get(ServerSetting, IMAGERY)
    return dict(row.value) if row else {}


def _key(stored: dict, settings) -> str | None:
    token = stored.get("google_key")
    return secrets.decrypt(settings.secret_key, token) if token else None


def _admin_view(stored: dict, settings) -> dict:
    key = _key(stored, settings)
    unreadable = bool(stored.get("google_key")) and key is None
    return {
        "provider": stored.get("provider", "esri"),
        "google_key_set": key is not None,
        "google_key_hint": secrets.hint(key) if key else None,
        "google_key_unreadable": unreadable,
        "google_3d": bool(stored.get("google_3d")),
    }


@router.get("/api/admin/imagery", dependencies=[AdminDep])
async def get_imagery(db: DbDep, settings: SettingsDep):
    return _admin_view(await _imagery(db), settings)


@router.put("/api/admin/imagery")
async def put_imagery(
    body: ImageryIn,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = AdminDep,
):
    stored = await _imagery(db)
    if body.google_key is not None:
        new_key = body.google_key.strip()
        if new_key:
            problem = await check_google_key(new_key)
            if problem:
                raise HTTPException(422, problem)
            stored["google_key"] = secrets.encrypt(
                settings.secret_key, new_key
            )
        else:
            stored.pop("google_key", None)
    if body.provider == "google" and not _key(stored, settings):
        raise HTTPException(422, "Add a Google Maps API key to use Google.")
    stored["provider"] = body.provider
    stored["google_3d"] = body.google_3d and body.provider == "google"
    row = await db.get(ServerSetting, IMAGERY)
    if row is None:
        row = ServerSetting(key=IMAGERY)
        db.add(row)
    row.value = stored
    row.updated_at = utcnow()
    row.updated_by = session.user_id
    await audit(
        db,
        "settings.imagery",
        session.user_id,
        client_ip(request),
        provider=body.provider,
        google_3d=stored["google_3d"],
        key_changed=body.google_key is not None,
    )
    await db.commit()
    return _admin_view(stored, settings)


DEFAULTS = "defaults"


class VideoDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    muted: bool = True
    volume: int = Field(default=50, ge=0, le=100)


class NewsDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Channel ids (YouTube or Rumble), in tab order.
    tabs: list[str] = Field(default_factory=list, max_length=40)


class DefaultsIn(BaseModel):
    """Server-wide starting points for every user: the layers and filters
    the map opens with (and resets to), the news tabs in order, how video
    starts and the Brief's sections. Users' own choices still win."""

    model_config = ConfigDict(extra="forbid")

    layers: dict | None = None
    news: NewsDefaults | None = None
    video: VideoDefaults | None = None
    brief: BriefPrefs | None = None
    # The theme everyone starts with (a built-in or custom id).
    theme: str | None = Field(
        default=None, pattern=r"^[a-z0-9][a-z0-9-]{0,39}$"
    )


async def read_defaults(db) -> dict:
    row = await db.get(ServerSetting, DEFAULTS)
    return dict(row.value or {}) if row else {}


@router.get("/api/admin/defaults", dependencies=[AdminDep])
async def get_defaults(db: DbDep):
    return await read_defaults(db)


@router.put("/api/admin/defaults")
async def put_defaults(
    body: DefaultsIn,
    request: Request,
    db: DbDep,
    session: UserSession = AdminDep,
):
    value = body.model_dump(exclude_none=True)
    if len(str(value)) > 20_000:
        raise HTTPException(422, "Defaults are too large.")
    row = await db.get(ServerSetting, DEFAULTS)
    if row is None:
        row = ServerSetting(key=DEFAULTS)
        db.add(row)
    row.value = value
    row.updated_at = utcnow()
    row.updated_by = session.user_id
    await audit(
        db,
        "settings.defaults",
        session.user_id,
        client_ip(request),
        parts=sorted(value),
    )
    await db.commit()
    return value


@router.get("/api/map/config")
async def map_config(session: SessionDep, db: DbDep, settings: SettingsDep):
    """What the map should load, for every signed-in user."""
    stored = await _imagery(db)
    key = _key(stored, settings)
    google = stored.get("provider") == "google" and key is not None
    return {
        "imagery": {
            "provider": "google" if google else "esri",
            "google_key": key if google else None,
            "google_3d": google and bool(stored.get("google_3d")),
        },
        "defaults": await read_defaults(db),
    }


@router.get(
    "/api/admin/audit", dependencies=[Depends(require("users.manage"))]
)
async def audit_log(
    db: DbDep,
    limit: int = Query(100, ge=1, le=500),
    before: int | None = Query(None, description="id to page back from"),
    action: str | None = Query(None, max_length=64),
):
    """Newest first. Page back with before=<last id>."""
    query = (
        select(AuditLog, User.username)
        .outerjoin(User, User.id == AuditLog.user_id)
        .order_by(AuditLog.id.desc())
        .limit(limit)
    )
    if before is not None:
        query = query.where(AuditLog.id < before)
    if action:
        query = query.where(AuditLog.action.like("{0}%".format(action)))
    rows = (await db.execute(query)).all()
    return {
        "entries": [
            {
                "id": a.id,
                "at": a.at.isoformat(),
                "action": a.action,
                "username": username,
                "ip": a.ip,
                "detail": a.detail or {},
            }
            for a, username in rows
        ]
    }
