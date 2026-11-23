"""Global Fishing Watch events for the view (argus/fishing.py)."""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from argus import secrets
from argus.api.deps import DbDep, SessionDep
from argus.events import parse_bbox
from argus.fishing import ATTRIBUTION, Forbidden
from argus.models import ServerSetting

router = APIRouter(tags=["fishing"])
log = logging.getLogger("argus.fishing")


@router.get("/api/fishing")
async def fishing_events(
    request: Request,
    session: SessionDep,
    db: DbDep,
    bbox: str = Query(..., description="west,south,east,north"),
):
    """Encounters, loitering and AIS gaps over the last 30 days for a
    regional view. status: ok, zoom (view too big), nokey, refused (the
    token was refused) or error."""
    try:
        box = parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if box is None:
        raise HTTPException(422, "bbox must be west,south,east,north")
    row = await db.get(ServerSetting, "keys")
    token = (row.value or {}).get("gfw") if row else None
    key = (
        secrets.decrypt(request.app.state.settings.secret_key, token)
        if token
        else None
    )
    out = {"events": [], "attribution": ATTRIBUTION}
    if not key:
        return out | {"status": "nokey"}
    try:
        found = await request.app.state.fishing.area(key, box)
    except Forbidden:
        log.warning("Global Fishing Watch refused the token")
        return out | {"status": "refused"}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("Global Fishing Watch failed: {0}".format(exc))
        return out | {"status": "error"}
    if found is None:
        return out | {"status": "zoom"}
    return out | {"status": "ok", "events": found}
