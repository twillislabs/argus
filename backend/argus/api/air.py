"""Aircraft and universal search."""

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from argus import search
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
    250 nm radius; otherwise civil_status says to zoom in.
    """
    try:
        box = parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    air = request.app.state.air
    out = {a["hex"]: a for a in air.in_bbox(box)}
    civil_status = "off"
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
                # The live military picture wins for aircraft in both.
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


@router.get("/api/aircraft/{hex_id}")
async def get_aircraft(request: Request, session: SessionDep, hex_id: str):
    """One aircraft: position, type details, route and its trail."""
    hex_id = hex_id.strip().lower()
    if len(hex_id) != 6 or any(c not in "0123456789abcdef" for c in hex_id):
        raise HTTPException(422, "Use the 6-character ICAO hex address.")
    air = request.app.state.air
    client = request.app.state.air_client
    aircraft = air.aircraft.get(hex_id) or client.seen_recently(hex_id)
    if aircraft is None:
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
