"""Traffic cameras: the catalogue for a regional view, and each camera's
latest still image, fetched by the server (cached half a minute) so
browsers never call the agencies.

/api/cams?bbox=        cameras in view (status zoom when the view is
                       wider than MAX_SPAN degrees)
/api/cams/{id}/image   that camera's current image
"""

import time

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response

from argus.api.deps import DbDep, SessionDep
from argus.cams import image_allowed
from argus.events import parse_bbox
from argus.models import ServerSetting

router = APIRouter(tags=["cams"])

CATALOGUE_TTL_S = 300
IMAGE_TTL_S = 30
IMAGE_MAX_BYTES = 2_000_000
MAX_SPAN = 8.0
MAX_CACHED = 400


async def catalogue(request: Request, db) -> dict[str, dict]:
    """Every camera by id, from the worker's stored catalogue (re-read
    every few minutes)."""
    state = request.app.state
    hit = getattr(state, "cams_catalogue", None)
    if hit and time.monotonic() - hit[0] < CATALOGUE_TTL_S:
        return hit[1]
    row = await db.get(ServerSetting, "layer:trafficcams")
    feeds = ((row.value or {}).get("feeds") or {}) if row else {}
    by_id = {c["id"]: c for cams in feeds.values() for c in cams}
    state.cams_catalogue = (time.monotonic(), by_id)
    return by_id


def _public(c: dict) -> dict:
    """What browsers get: no agency URLs, our image path instead."""
    return {
        k: c.get(k)
        for k in (
            "id",
            "name",
            "road",
            "place",
            "direction",
            "lat",
            "lon",
            "agency",
            "refresh_s",
        )
    } | {
        "image": "/api/cams/{0}/image".format(c["id"]),
        "video": bool(c.get("stream")),
    }


@router.get("/api/cams")
async def cams_in_view(
    request: Request,
    session: SessionDep,
    db: DbDep,
    bbox: str = Query(..., description="west,south,east,north"),
):
    try:
        w, s, e, n = parse_bbox(bbox)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "bbox must be west,south,east,north") from exc
    if e < w or e - w > MAX_SPAN or n - s > MAX_SPAN:
        return {"cameras": [], "status": "zoom"}
    cams = await catalogue(request, db)
    shown = [
        _public(c)
        for c in cams.values()
        if w <= c["lon"] <= e and s <= c["lat"] <= n
    ]
    return {"cameras": shown[:1500], "status": "ok"}


def _client(request: Request) -> httpx.AsyncClient:
    state = request.app.state
    if not hasattr(state, "cams_http"):
        state.cams_http = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            headers={"User-Agent": state.settings.user_agent},
            follow_redirects=False,
        )
        state.cams_images = {}
    return state.cams_http


@router.get("/api/cams/{cam_id}/image")
async def cam_image(
    cam_id: str, request: Request, session: SessionDep, db: DbDep
):
    cams = await catalogue(request, db)
    cam = cams.get(cam_id)
    if cam is None or not image_allowed(cam.get("image") or ""):
        raise HTTPException(404, "No such camera.")
    client = _client(request)
    cache = request.app.state.cams_images
    hit = cache.get(cam_id)
    if not hit or time.monotonic() - hit[0] > IMAGE_TTL_S:
        try:
            r = await client.get(cam["image"])
        except httpx.HTTPError as exc:
            raise HTTPException(502, "The camera didn't answer.") from exc
        kind = r.headers.get("content-type", "").split(";")[0]
        if r.status_code != 200 or not kind.startswith("image/"):
            raise HTTPException(502, "The camera has no image right now.")
        if len(r.content) > IMAGE_MAX_BYTES:
            raise HTTPException(502, "The camera's image is too large.")
        hit = (time.monotonic(), r.content, kind)
        cache[cam_id] = hit
        if len(cache) > MAX_CACHED:
            oldest = min(cache, key=lambda k: cache[k][0])
            cache.pop(oldest, None)
    return Response(
        content=hit[1],
        media_type=hit[2],
        headers={"Cache-Control": "private, max-age={0}".format(IMAGE_TTL_S)},
    )
