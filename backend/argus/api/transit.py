"""Public transport: vehicles in view from operators' open GTFS-Realtime
feeds (argus/transit.py).

/api/transit?bbox=   vehicles in a city-sized view (status "zoom" when
                     the view is wider than MAX_SPAN degrees), and the
                     operators they come from, with their licences
"""

from fastapi import APIRouter, HTTPException, Query, Request

from argus.api.deps import SessionDep
from argus.events import parse_bbox

router = APIRouter(tags=["transit"])

MAX_SPAN = 6.0


@router.get("/api/transit")
async def transit(
    request: Request,
    session: SessionDep,
    bbox: str = Query(..., description="west,south,east,north"),
):
    try:
        w, s, e, n = parse_bbox(bbox)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "bbox must be west,south,east,north") from exc
    if e < w or e - w > MAX_SPAN or n - s > MAX_SPAN:
        return {"status": "zoom", "vehicles": [], "operators": []}
    return await request.app.state.transit.in_view(w, s, e, n)
