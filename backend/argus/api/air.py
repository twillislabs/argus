"""Aircraft and universal search."""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from argus import geocode, search
from argus.api.deps import DbDep, SessionDep
from argus.aviation import RateLimited, pick_route, radius_for_bbox
from argus.events import parse_bbox

router = APIRouter(tags=["aircraft"])
log = logging.getLogger("argus.air")


@router.get("/api/aircraft")
async def list_aircraft(
    request: Request,
    session: SessionDep,
    bbox: str | None = Query(None, description="west,south,east,north"),
    civil: bool = Query(True, description="include civil traffic"),
):
    """Military aircraft everywhere, plus civil traffic for a regional view.

    Civil aircraft are fetched from adsb.lol only when the view fits in a
    250 nm radius; otherwise civil_status says to zoom in. With
    ARGUS_AIR_ENABLED=false (test stacks) nothing is fetched: the feeds'
    quota is shared by every stack on the machine.
    """
    try:
        box = parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    air = request.app.state.air
    # Your own receiver first, then the live military picture on top.
    local = request.app.state.local_air
    out = {a["hex"]: a for a in local.in_bbox(box)}
    out.update({a["hex"]: a for a in air.in_bbox(box)})
    civil_status = "off"
    if not request.app.state.settings.air_enabled:
        civil = False
    if civil and box is not None:
        area = radius_for_bbox(box)
        if area is None:
            civil_status = "zoom"
        else:
            lat, lon, radius = area
            try:
                fetched = await request.app.state.air_client.area(
                    lat, lon, radius
                )
                inside = {a["hex"]: a for a in _clip(fetched, box)}
                # The live military picture and your receiver win for
                # aircraft in both.
                out = inside | out
                civil_status = "ok"
            except RateLimited:
                civil_status = "limited"
            except Exception as exc:  # noqa: BLE001 - military still shown
                log.warning("Civil aircraft fetch failed: {0}".format(exc))
                civil_status = "error"
    elif civil:
        civil_status = "zoom"
    return {
        "aircraft": list(out.values()),
        "civil_status": civil_status,
        "updated": air.updated,
    }


def _clip(aircraft: list[dict], box) -> list[dict]:
    w, s, e, n = box
    return [
        a
        for a in aircraft
        if s <= a["lat"] <= n
        and (
            (w <= a["lon"] <= e)
            if w <= e
            else (a["lon"] >= w or a["lon"] <= e)
        )
    ]


@router.get("/api/airports/status")
async def airport_status(request: Request, session: SessionDep):
    """FAA ground stops, delays and closure notices for US airports."""
    return await request.app.state.faa.get()


@router.get("/api/aircraft/{hex_id}")
async def get_aircraft(request: Request, session: SessionDep, hex_id: str):
    """One aircraft: position, type details, route and its trail."""
    hex_id = hex_id.strip().lower()
    if len(hex_id) != 6 or any(c not in "0123456789abcdef" for c in hex_id):
        raise HTTPException(422, "Use the 6-character ICAO hex address.")
    air = request.app.state.air
    client = request.app.state.air_client
    aircraft = (
        air.aircraft.get(hex_id)
        or request.app.state.local_air.aircraft.get(hex_id)
        or client.seen_recently(hex_id)
    )
    if aircraft is None and request.app.state.settings.air_enabled:
        try:
            hits = await client.lookup("hex", hex_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("Aircraft lookup failed: {0}".format(exc))
            hits = []
        aircraft = hits[0] if hits else None
    if aircraft is None:
        raise HTTPException(404, "That aircraft isn't being seen right now.")
    detail = route = progress = None
    try:
        detail = await client.detail(hex_id)
        if aircraft.get("callsign") and not aircraft.get("mil"):
            legs = await client.route_legs(aircraft["callsign"])
            route, progress = pick_route(
                legs, aircraft["lat"], aircraft["lon"], aircraft.get("track")
            )
    except Exception as exc:  # noqa: BLE001 - position is still useful
        log.warning("Route lookup failed: {0}".format(exc))
    trail = [list(p) for p in air.trails.get(hex_id, [])]
    return {
        "aircraft": aircraft,
        "detail": detail,
        "route": route,
        "progress": progress,
        "trail": trail,
    }


@router.get("/api/search")
async def universal_search(
    request: Request,
    session: SessionDep,
    db: DbDep,
    q: str = Query(..., min_length=1, max_length=100),
):
    """Decode anything typed in the search box; see argus.search."""
    results = await search.resolve(
        q,
        db,
        request.app.state.air,
        request.app.state.air_client,
        ships=request.app.state.sea,
    )
    return {"query": q, "results": results}


@router.get("/api/geocode")
async def find_address(
    request: Request,
    session: SessionDep,
    q: str = Query(..., min_length=3, max_length=200),
):
    """Addresses for the search box's "Find address" (Nominatim). Only on
    request, never as you type: Nominatim's policy forbids autocomplete.
    """
    lang = (request.headers.get("accept-language") or "en")[:40]
    try:
        found = await request.app.state.geocoder.search(q.strip(), lang)
    except geocode.Busy as exc:
        raise HTTPException(429, "Address search is busy; try again.") from exc
    except httpx.HTTPError as exc:
        log.warning("Address search failed: {0}".format(exc))
        raise HTTPException(502, "The address service didn't answer.") from exc
    return {"results": found, "attribution": geocode.ATTRIBUTION}


@router.get("/api/gps")
async def gps_interference(request: Request, session: SessionDep):
    """GPS interference cells: the share of aircraft with a degraded
    position (NACp < 8) per 1-degree cell over the last hour."""
    cells = request.app.state.gps.summary()
    return {"cells": cells, "window_s": request.app.state.gps.WINDOW_S}
