"""Recent Sentinel imagery for a box (argus/imagery.py)."""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response

from argus.api.deps import SessionDep
from argus.events import parse_bbox
from argus.imagery import KINDS, ImageryError

router = APIRouter(tags=["imagery"])
log = logging.getLogger("argus.imagery")

ATTRIBUTION = (
    "Contains modified Copernicus Sentinel data, via Microsoft Planetary "
    "Computer"
)


def _box(bbox: str):
    try:
        box = parse_bbox(bbox)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "bbox must be west,south,east,north") from exc
    if box is None:
        raise HTTPException(422, "bbox must be west,south,east,north")
    return box


@router.get("/api/imagery/passes")
async def imagery_passes(
    request: Request,
    session: SessionDep,
    kind: str = Query("optical", pattern="^(optical|radar)$"),
    bbox: str = Query(..., description="west,south,east,north"),
):
    box = _box(bbox)
    try:
        found = await request.app.state.imagery.passes(kind, box)
    except ImageryError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        log.warning("Imagery search failed: {0}".format(exc))
        raise HTTPException(
            502, "The imagery catalogue didn't answer."
        ) from exc
    return {"passes": found, "attribution": ATTRIBUTION}


AERIAL_ATTRIBUTION = (
    "NAIP aerial photos: USDA Farm Production and Conservation Business "
    "Center, via Microsoft Planetary Computer"
)


@router.get("/api/imagery/aerial")
async def imagery_aerial(
    request: Request,
    session: SessionDep,
    bbox: str = Query(..., description="west,south,east,north"),
):
    """Sharp aerial photos for close zoom, where there are any (the US)."""
    box = _box(bbox)
    try:
        found = await request.app.state.imagery.aerial(box)
    except ImageryError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        log.warning("Aerial search failed: {0}".format(exc))
        raise HTTPException(
            502, "The imagery catalogue didn't answer."
        ) from exc
    if not found["available"]:
        return {"available": False, "dates": [], "tiles": None}
    return {
        "available": True,
        "dates": found["dates"],
        "tiles": "/api/imagery/tiles/aerial/{0}/{{z}}/{{x}}/{{y}}.png".format(
            found["sid"]
        ),
        "attribution": AERIAL_ATTRIBUTION,
    }


@router.get("/api/imagery/mosaic")
async def imagery_mosaic(
    request: Request,
    session: SessionDep,
    kind: str = Query("optical", pattern="^(optical|radar)$"),
    bbox: str = Query(...),
    date: str = Query(..., max_length=10),
):
    box = _box(bbox)
    try:
        sid = await request.app.state.imagery.mosaic(kind, box, date)
    except ImageryError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        log.warning("Imagery mosaic failed: {0}".format(exc))
        raise HTTPException(502, "The imagery service didn't answer.") from exc
    return {
        "tiles": "/api/imagery/tiles/{0}/{1}/{{z}}/{{x}}/{{y}}.png".format(
            kind, sid
        ),
        "attribution": ATTRIBUTION,
    }


@router.get("/api/imagery/tiles/{kind}/{sid}/{z}/{x}/{y}.png")
async def imagery_tile(
    request: Request,
    session: SessionDep,
    kind: str,
    sid: str,
    z: int,
    x: int,
    y: int,
):
    if kind not in KINDS:
        raise HTTPException(404, "No such tile.")
    try:
        data = await request.app.state.imagery.tile(kind, sid, z, x, y)
    except ImageryError as exc:
        raise HTTPException(404, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "The imagery service didn't answer.") from exc
    if data is None:
        return Response(status_code=204)
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=86400"},
    )
