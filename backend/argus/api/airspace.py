"""Airspace areas in force: TFRs, SIGMETs and conflict zone bulletins."""

import logging
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import select

from argus.api.deps import DbDep, SessionDep
from argus.db import utcnow
from argus.models import RawRecord
from argus.openaip import Blocked

router = APIRouter(tags=["airspace"])
log = logging.getLogger("argus.airspace")

# How recently a record must have been refreshed to still count: TFRs
# refresh hourly, CZIBs daily; SIGMETs carry their own end time.
FRESH = {
    "faa_tfr": timedelta(hours=2),
    "czib": timedelta(hours=26),
    "sigmet": timedelta(hours=12),
}


def _ended(valid_to: str | None, now: datetime) -> bool:
    if not valid_to:
        return False
    try:
        end = datetime.fromisoformat(valid_to.replace("Z", "+00:00"))
    except ValueError:
        return False
    if end.tzinfo is None:
        # CZIBs give a date: valid through the end of that day.
        end = end.replace(tzinfo=now.tzinfo) + timedelta(days=1)
    return end < now


@router.get("/api/airspace")
async def list_airspace(session: SessionDep, db: DbDep):
    now = utcnow()
    oldest = now - max(FRESH.values())
    rows = (
        await db.execute(
            select(RawRecord).where(
                RawRecord.kind == "airspace",
                RawRecord.fetched_at >= oldest,
            )
        )
    ).scalars()
    items = []
    for r in rows:
        if r.fetched_at < now - FRESH.get(r.source, timedelta(hours=2)):
            continue
        p = r.payload
        if _ended(p.get("valid_to"), now):
            continue
        items.append(
            {
                "key": "{0}:{1}".format(r.source, r.external_id),
                "kind": p.get("kind"),
                "id": p.get("id"),
                "title": p.get("title"),
                "hazard": p.get("hazard"),
                "area": p.get("area") or p.get("region"),
                "countries": p.get("countries"),
                "valid_from": p.get("valid_from") or p.get("issued"),
                "valid_to": p.get("valid_to"),
                "base_ft": p.get("base_ft"),
                "top_ft": p.get("top_ft"),
                "facility": p.get("facility"),
                "polygon": p.get("polygon"),
                "raw": p.get("raw"),
                "url": p.get("url"),
                "lat": r.lat,
                "lon": r.lon,
            }
        )
    items.sort(key=lambda i: (i["kind"] or "", i["id"] or ""))
    return {"items": items}


@router.get("/api/layers/cables")
async def submarine_cables(session: SessionDep, db: DbDep):
    """TeleGeography's submarine cables and landing points (CC BY-NC-SA),
    as last fetched by the worker."""
    from argus.models import ServerSetting

    row = await db.get(ServerSetting, "layer:cables")
    value = dict(row.value) if row else {}
    return {
        "fetched": value.get("fetched"),
        "cables": value.get("cables") or {"features": []},
        "landings": value.get("landings") or {"features": []},
        "attribution": "TeleGeography (CC BY-NC-SA 4.0)",
    }


@router.get("/api/advisories")
async def travel_advisories(session: SessionDep, db: DbDep):
    """US State Department and UK FCDO travel advisories per country
    (Natural Earth names), as last fetched by the worker."""
    from argus.advisories import merged
    from argus.models import ServerSetting

    row = await db.get(ServerSetting, "layer:advisories")
    value = dict(row.value) if row else {}
    return {
        "fetched": value.get("fetched"),
        "countries": merged(value),
        "attribution": "US Department of State (public domain); "
        "UK FCDO (Open Government Licence v3.0)",
    }


@router.get("/api/wikipedia")
async def wikipedia_events(session: SessionDep, db: DbDep):
    """Wikipedia's Current events (the last few days, newest first), as
    last fetched by the worker."""
    from argus.models import ServerSetting

    row = await db.get(ServerSetting, "layer:wikipedia")
    value = dict(row.value) if row else {}
    return {
        "fetched": value.get("fetched"),
        "items": value.get("items") or [],
        "attribution": "Wikipedia, Portal:Current events (CC BY-SA 4.0)",
    }


@router.get("/api/airspace/structure")
async def airspace_structure(
    request: Request,
    session: SessionDep,
    db: DbDep,
    bbox: str = Query(..., description="west,south,east,north"),
):
    """openAIP airspace (restricted areas, CTRs, TMAs...) for a regional
    view. status: ok, zoom (view too big), nokey, blocked (openAIP's
    Cloudflare refuses this server) or error."""
    from argus import secrets
    from argus.events import parse_bbox
    from argus.models import ServerSetting

    try:
        box = parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = await db.get(ServerSetting, "keys")
    token = (row.value or {}).get("openaip") if row else None
    key = (
        secrets.decrypt(request.app.state.settings.secret_key, token)
        if token
        else None
    )
    if not key:
        return {"items": [], "status": "nokey"}
    try:
        items = await request.app.state.openaip.area(key, box)
    except Blocked:
        log.warning("openAIP's Cloudflare is refusing this server (403)")
        return {"items": [], "status": "blocked"}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("openAIP failed: {0}".format(exc))
        return {"items": [], "status": "error"}
    if items is None:
        return {"items": [], "status": "zoom"}
    return {"items": items, "status": "ok"}
