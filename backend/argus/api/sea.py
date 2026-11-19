"""Vessels from the live AIS picture, and data source keys (admins)."""

import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from argus import sea, secrets
from argus.api.deps import DbDep, SessionDep, SettingsDep, client_ip, require
from argus.db import utcnow
from argus.events import parse_bbox
from argus.models import ServerSetting, UserSession
from argus.services import audit

router = APIRouter(tags=["sea"])

KEYS = "keys"
# Keys an admin can set, with what they unlock.
KNOWN_KEYS = {
    "aisstream": "Live vessels (AIS) from aisstream.io",
    "openaip": "Airspace structure (restricted areas, CTRs) from openaip.net",
    "tdot": "Tennessee traffic cameras from the TDOT open-data API",
}
PRUNE_EVERY_S = 60
ManageDep = Annotated[UserSession, Depends(require("settings.manage"))]


def _picture(request: Request) -> sea.LiveSea:
    live: sea.LiveSea = request.app.state.sea
    last = getattr(request.app.state, "sea_pruned", 0.0)
    if time.time() - last > PRUNE_EVERY_S:
        live.prune()
        request.app.state.sea_pruned = time.time()
    return live


async def _keys(db) -> dict:
    row = await db.get(ServerSetting, KEYS)
    return dict(row.value) if row else {}


@router.get("/api/vessels")
async def list_vessels(
    request: Request,
    session: SessionDep,
    db: DbDep,
    bbox: str | None = Query(None, description="west,south,east,north"),
    limit: int = Query(4000, ge=1, le=8000),
):
    """Vessels in view, most interesting first (military, tankers,
    passenger, cargo), up to limit, with the total in the box."""
    try:
        box = parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    live = _picture(request)
    hits, total = live.in_bbox(box, limit)
    if hits:
        status = "ok"
    elif "aisstream" not in await _keys(db):
        status = "nokey"
    else:
        status = "waiting" if not live.vessels else "ok"
    return {
        "vessels": [sea.public(v) for v in hits],
        "total": total,
        "status": status,
    }


@router.get("/api/vessels/{mmsi}")
async def get_vessel(request: Request, session: SessionDep, mmsi: int):
    v = _picture(request).vessels.get(mmsi)
    if v is None or "lat" not in v:
        raise HTTPException(404, "That vessel isn't being seen right now.")
    return sea.public(v)


# --- data source keys (admins) ----------------------------------------------


class KeysIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Omit a key to keep it, "" to remove it.
    aisstream: str | None = Field(default=None, max_length=200)
    openaip: str | None = Field(default=None, max_length=200)
    tdot: str | None = Field(default=None, max_length=200)


def _view(stored: dict, settings) -> dict:
    out = {}
    for name, purpose in KNOWN_KEYS.items():
        token = stored.get(name)
        key = secrets.decrypt(settings.secret_key, token) if token else None
        out[name] = {
            "purpose": purpose,
            "set": key is not None,
            "hint": secrets.hint(key) if key else None,
            "unreadable": bool(token) and key is None,
        }
    return out


@router.get(
    "/api/admin/keys", dependencies=[Depends(require("settings.manage"))]
)
async def get_keys(db: DbDep, settings: SettingsDep):
    return _view(await _keys(db), settings)


@router.put("/api/admin/keys")
async def put_keys(
    body: KeysIn,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: ManageDep,
):
    stored = await _keys(db)
    changed = []
    for name, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        value = value.strip()
        if value:
            stored[name] = secrets.encrypt(settings.secret_key, value)
        else:
            stored.pop(name, None)
        changed.append(name)
    row = await db.get(ServerSetting, KEYS)
    if row is None:
        row = ServerSetting(key=KEYS)
        db.add(row)
    row.value = stored
    row.updated_at = utcnow()
    row.updated_by = session.user_id
    await audit(
        db, "settings.keys", session.user_id, client_ip(request), keys=changed
    )
    await db.commit()
    return _view(stored, settings)


# --- your own receivers (admins) ---------------------------------------------

RECEIVERS = "receivers"


class ReceiversIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adsb_url: str | None = Field(default=None, max_length=300)
    ais_url: str | None = Field(default=None, max_length=300)


def _url_ok(url: str) -> bool:
    return url.startswith(("http://", "https://")) and " " not in url


@router.get(
    "/api/admin/receivers", dependencies=[Depends(require("settings.manage"))]
)
async def get_receivers(db: DbDep):
    row = await db.get(ServerSetting, RECEIVERS)
    value = dict(row.value) if row else {}
    return {"adsb_url": value.get("adsb_url"), "ais_url": value.get("ais_url")}


@router.put("/api/admin/receivers")
async def put_receivers(
    body: ReceiversIn, request: Request, db: DbDep, session: ManageDep
):
    value = {}
    for name in ("adsb_url", "ais_url"):
        url = (getattr(body, name) or "").strip()
        if url and not _url_ok(url):
            raise HTTPException(
                422, "Receiver addresses start with http:// or https://."
            )
        if url:
            value[name] = url
    row = await db.get(ServerSetting, RECEIVERS)
    if row is None:
        row = ServerSetting(key=RECEIVERS)
        db.add(row)
    row.value = value
    row.updated_at = utcnow()
    row.updated_by = session.user_id
    await audit(
        db,
        "settings.receivers",
        session.user_id,
        client_ip(request),
        adsb=bool(value.get("adsb_url")),
        ais=bool(value.get("ais_url")),
    )
    await db.commit()
    return {"adsb_url": value.get("adsb_url"), "ais_url": value.get("ais_url")}
