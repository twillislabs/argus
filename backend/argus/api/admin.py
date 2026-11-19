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
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from argus import secrets
from argus.api.deps import (
    DbDep,
    SessionDep,
    SettingsDep,
    client_ip,
    require,
)
from argus.db import utcnow
from argus.models import ServerSetting, UserSession
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
        }
    }
