"""Events, summary, sources, news, place search and the live socket."""

import asyncio
import time
from urllib.parse import urlsplit

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy import or_, select

from argus import events as ev
from argus import places, tension, youtube
from argus.api.deps import SESSION_COOKIE, DbDep, SessionDep
from argus.models import Article, Event
from argus.services import load_session

router = APIRouter(tags=["events"])

TYPES = ("conflict", "unrest", "quake", "fire", "hazard", "maritime")


@router.get("/api/events")
async def list_events(
    session: SessionDep,
    db: DbDep,
    bbox: str | None = Query(None, description="west,south,east,north"),
    types: str | None = Query(None, description="comma list, e.g. quake,fire"),
    min_severity: int = Query(1, ge=1, le=5),
    hours: int = Query(24, ge=1, le=24 * 30),
    candidates: bool = Query(False, description="include unconfirmed"),
    limit: int = Query(2000, ge=1, le=10000),
):
    try:
        box = ev.parse_bbox(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    wanted = [t for t in (types or "").split(",") if t in TYPES] or None
    rows = await ev.query_events(
        db,
        bbox=box,
        types=wanted,
        min_severity=min_severity,
        hours=hours,
        include_candidates=candidates,
        limit=limit,
    )
    return {"events": [ev.event_dict(e) for e in rows]}


@router.get("/api/events/{event_id}")
async def get_event(event_id: str, session: SessionDep, db: DbDep):
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "No event with that id.")
    return {
        "event": ev.event_dict(event),
        "sources": await ev.event_sources(db, event),
        "articles": [
            ev.article_dict(a) for a in await ev.related_articles(db, event)
        ],
    }


@router.get("/api/summary")
async def get_summary(
    session: SessionDep, db: DbDep, hours: int = Query(24, ge=1, le=168)
):
    return await ev.summary(db, hours)


TENSION_CACHE_S = 60


@router.get("/api/tension")
async def get_tension(session: SessionDep, db: DbDep, request: Request):
    """The tension index, computed at most once a minute for everyone."""
    state = request.app.state
    cached = getattr(state, "tension_cache", None)
    now = time.monotonic()
    if cached and now - cached[0] < TENSION_CACHE_S:
        return cached[1]
    body = await tension.snapshot(db)
    state.tension_cache = (now, body)
    return body


@router.get("/api/sources")
async def get_sources(session: SessionDep, db: DbDep):
    return {"sources": await ev.source_status(db)}


@router.get("/api/news")
async def get_news(
    session: SessionDep,
    db: DbDep,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(30, ge=1, le=200),
):
    query = select(Article).order_by(Article.published_at.desc())
    if q:
        like = "%{0}%".format(q.replace("%", "").replace("_", ""))
        query = query.where(
            or_(Article.title.ilike(like), Article.summary.ilike(like))
        )
    rows = (await db.execute(query.limit(limit))).scalars()
    return {"articles": [ev.article_dict(a) for a in rows]}


@router.get("/api/news/live/{channel}")
async def live_video(
    channel: str,
    session: SessionDep,
    request: Request,
    platform: str = Query("youtube", pattern="^(youtube|rumble)$"),
):
    """A channel's current live video, for the news player."""
    if not youtube.valid_channel(platform, channel):
        raise HTTPException(422, "Not a channel ID for that platform.")
    return await request.app.state.youtube.resolve(channel, platform)


@router.get("/api/places")
async def search_places(
    q: str = Query(..., min_length=2, max_length=80),
    limit: int = Query(8, ge=1, le=25),
):
    """Offline city search (GeoNames). Public: setup needs it before any
    account exists, and it only reads bundled reference data."""
    hits = await asyncio.to_thread(places.search, q, limit)
    return {
        "places": [
            {
                "name": p.name,
                "label": p.label(),
                "region": p.region,
                "country": p.country,
                "cc": p.cc,
                "lat": p.lat,
                "lon": p.lon,
                "population": p.population,
                "tz": p.tz,
            }
            for p in hits
        ],
        "attribution": "GeoNames (CC BY 4.0)",
    }


@router.get("/api/places/nearest")
async def nearest_place(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Closest listed place within 500 km, used for the home time zone."""
    p = await asyncio.to_thread(places.nearest, lat, lon, 500)
    if p is None:
        return {"place": None}
    return {
        "place": {
            "name": p.name,
            "label": p.label(),
            "lat": p.lat,
            "lon": p.lon,
            "tz": p.tz,
        }
    }


REVALIDATE_S = 300


@router.websocket("/ws/live")
async def live_socket(ws: WebSocket):
    """Pushes {"type": "events", "events": [...]} as the worker fuses them.

    Requires a signed-in session cookie. The Origin must match the Host so
    other sites can't open a socket with the user's cookies.
    """
    app = ws.app
    origin = ws.headers.get("origin")
    if origin and urlsplit(origin).netloc != ws.headers.get("host"):
        await ws.close(code=1008)
        return
    token = ws.cookies.get(SESSION_COOKIE)

    async def valid() -> bool:
        if not token:
            return False
        async with app.state.db.sessionmaker() as db:
            return (
                await load_session(db, token, app.state.settings)
            ) is not None

    if not await valid():
        await ws.close(code=1008)
        return
    await ws.accept()
    hub = app.state.hub
    hub.clients.add(ws)
    try:
        await ws.send_json({"type": "hello"})
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), REVALIDATE_S)
            except TimeoutError:
                if not await valid():
                    await ws.close(code=1008)
                    return
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)
