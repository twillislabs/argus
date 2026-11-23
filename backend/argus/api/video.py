"""Live streams near the view, video about an event (YouTube, with an
admin's key) and webcams near the view (Windy, with a key). See
argus/video.py.

GET /api/video/near?lat=&lon=&radius_km=   live YouTube streams there
GET /api/video/event/{id}                  recent videos about an event
GET /api/webcams?bbox=                     Windy webcams in view
GET /api/webcams/{id}/image                that webcam's preview image

status: ok, nokey (add the key in Settings > Data sources), quota
(YouTube's daily quota is used up), zoom (view too wide) or error.
"""

import logging
import math
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from argus import secrets
from argus.api.deps import DbDep, SessionDep, require
from argus.events import parse_bbox
from argus.models import Event, ServerSetting
from argus.video import NoKey, Quota

log = logging.getLogger("argus.api.video")
router = APIRouter(tags=["video"])

WORDS = {
    "conflict": "attack",
    "unrest": "protest",
    "incident": "",
    "quake": "earthquake",
    "fire": "fire",
    "hazard": "",
    "maritime": "ship",
}
IMAGE_TTL_S = 300


async def _key(request: Request, db, name: str) -> str | None:
    row = await db.get(ServerSetting, "keys")
    token = (row.value or {}).get(name) if row else None
    if not token:
        return None
    return secrets.decrypt(request.app.state.settings.secret_key, token)


async def _answer(job):
    try:
        return {"status": "ok", "items": await job}
    except NoKey:
        return {"status": "nokey", "items": []}
    except Quota:
        return {"status": "quota", "items": []}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("video lookup failed: {0}".format(exc))
        return {"status": "error", "items": []}


@router.get("/api/video/near", dependencies=[Depends(require("video.search"))])
async def live_near(
    request: Request,
    session: SessionDep,
    db: DbDep,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(100, ge=5, le=1000),
):
    """Live streams in the area: YouTube (with the key) by location,
    and Dailymotion (no key) by the names of the area's biggest places.
    status is YouTube's (nokey, quota...) when Dailymotion found nothing
    either; sources says how each did."""
    video = request.app.state.video
    key = await _key(request, db, "youtube")
    yt = await _answer(video.live_near(key, lat, lon, radius_km))
    dm = await _answer(video.dailymotion_near(lat, lon, radius_km))
    for v in yt["items"]:
        v.setdefault("platform", "youtube")
    items = yt["items"] + dm["items"]
    status = "ok" if items or yt["status"] == "ok" else yt["status"]
    return {
        "status": status,
        "items": items,
        "sources": {"youtube": yt["status"], "dailymotion": dm["status"]},
    }


@router.get(
    "/api/video/event/{event_id}",
    dependencies=[Depends(require("video.search"))],
)
async def event_video(
    event_id: str, request: Request, session: SessionDep, db: DbDep
):
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "No event with that id.")
    # The place (town first) and what happened, in plain words.
    place = (event.place or "").split(",")[0].strip()
    words = WORDS.get(event.type, "")
    query = " ".join(x for x in (place, words) if x) or event.title
    key = await _key(request, db, "youtube")
    return await _answer(
        request.app.state.video.about_event(
            key, event.id, query, event.first_seen, event.lat, event.lon
        )
    )


@router.get("/api/webcams")
async def webcams(
    request: Request,
    session: SessionDep,
    db: DbDep,
    bbox: str = Query(..., description="west,south,east,north"),
):
    try:
        w, s, e, n = parse_bbox(bbox)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "bbox must be west,south,east,north") from exc
    if e < w or e - w > 8 or n - s > 8:
        return {"status": "zoom", "items": []}
    lat, lon = (s + n) / 2, (w + e) / 2
    # Half the diagonal, so the circle covers the view.
    radius = math.hypot(
        (e - w) / 2 * 111 * math.cos(math.radians(lat)), (n - s) / 2 * 111
    )
    key = await _key(request, db, "windy")
    out = await _answer(
        request.app.state.video.webcams_near(key, lat, lon, int(radius) + 1)
    )
    store = request.app.state.webcam_images = getattr(
        request.app.state, "webcam_images", {}
    )
    for cam in out["items"]:
        if cam.get("image"):
            store[cam["id"]] = (time.monotonic(), cam["image"])
            cam["image"] = "/api/webcams/{0}/image".format(cam["id"])
    if len(store) > 3000:
        cutoff = time.monotonic() - IMAGE_TTL_S
        for k in [k for k, v in store.items() if v[0] < cutoff]:
            store.pop(k, None)
    out["attribution"] = "Webcams provided by windy.com"
    return out


@router.get("/api/webcams/{cam_id}/image")
async def webcam_image(cam_id: str, request: Request, session: SessionDep):
    """The preview image, fetched from the URL Windy's API gave (valid a
    few minutes; the map asks for the list again after that)."""
    store = getattr(request.app.state, "webcam_images", {})
    hit = store.get(cam_id)
    if not hit or time.monotonic() - hit[0] > IMAGE_TTL_S:
        raise HTTPException(404, "That image has expired; reload the webcams.")
    try:
        r = await request.app.state.video.client.get(hit[1])
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Windy didn't answer.") from exc
    kind = r.headers.get("content-type", "").split(";")[0]
    if r.status_code != 200 or not kind.startswith("image/"):
        raise HTTPException(502, "No image right now.")
    return Response(
        content=r.content,
        media_type=kind,
        headers={"Cache-Control": "private, max-age=120"},
    )
