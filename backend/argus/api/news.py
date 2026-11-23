"""Settings > News feeds and Live channels (admins): the RSS / Atom feeds
the worker reads, and the live channels the news player offers.

Each list is the built-in one until an admin saves an edited list
(argus/newsconfig.py); Reset deletes the edit. A feed can be tested
before it's saved: the server fetches it and shows what it parsed. A
channel is added from a link, @handle or ID, looked up on YouTube or
Rumble for its ID, name and whether it's live now.
"""

import html
from datetime import UTC, datetime

import httpx
from defusedxml import ElementTree
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from argus import newsconfig, youtube
from argus.alerts import url_allowed
from argus.api.deps import DbDep, SettingsDep, client_ip, require
from argus.collectors.rss import parse_feed
from argus.db import utcnow
from argus.models import ServerSetting, Source, UserSession
from argus.services import audit

router = APIRouter(tags=["news settings"])
AdminDep = Depends(require("settings.manage"))
FEED_MAX_BYTES = 5_000_000


class FeedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outlet: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=500)
    section: str = Field(default="General", max_length=40)
    based: str = Field(default="us", pattern="^(us|world)$")
    enabled: bool = True

    @field_validator("url")
    @classmethod
    def http_url(cls, v: str) -> str:
        v = v.strip()
        if not url_allowed(v):
            raise ValueError("Give the feed's http(s) address.")
        return v


class FeedsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[FeedIn] = Field(max_length=newsconfig.MAX_FEEDS)
    # Every section, in order, including empty ones.
    sections: list[str] | None = Field(
        default=None, max_length=newsconfig.MAX_NAMES
    )


class ChannelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    short: str = Field(default="", max_length=24)
    group: str = Field(default="Other", max_length=40)
    platform: str = Field(default="youtube", pattern=youtube.PLATFORM_PATTERN)
    enabled: bool = True


class ChannelsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ChannelIn] = Field(max_length=newsconfig.MAX_CHANNELS)
    # Every group, in order, including empty ones.
    groups: list[str] | None = Field(
        default=None, max_length=newsconfig.MAX_NAMES
    )


class TestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=8, max_length=500)
    outlet: str = Field(default="Test", max_length=80)


class LookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str = Field(min_length=2, max_length=300)
    platform: str = Field(default="youtube", pattern=youtube.PLATFORM_PATTERN)


async def _save(
    db, key: str, items: list[dict] | None, user_id, **extra
) -> None:
    row = await db.get(ServerSetting, key)
    if items is None:
        if row is not None:
            await db.delete(row)
        return
    if row is None:
        row = ServerSetting(key=key)
        db.add(row)
    row.value = {"items": items, **extra}
    row.updated_at = utcnow()
    row.updated_by = user_id


async def _failing(db) -> list[str]:
    """Outlets the last RSS run couldn't read."""
    source = await db.get(Source, "rss")
    err = (source.last_error or "") if source else ""
    if not err.startswith("Failed: "):
        return []
    return [x.strip() for x in err[len("Failed: ") :].split(",") if x.strip()]


@router.get("/api/admin/news/feeds", dependencies=[AdminDep])
async def get_feeds(db: DbDep, settings: SettingsDep):
    items = await newsconfig.feeds(db, settings)
    return {
        "items": items,
        "sections": await newsconfig.names(
            db, newsconfig.FEEDS_KEY, "sections", [f["section"] for f in items]
        ),
        "customised": await newsconfig.customised(db, newsconfig.FEEDS_KEY),
        "failing": await _failing(db),
    }


@router.put("/api/admin/news/feeds")
async def put_feeds(
    body: FeedsIn,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = AdminDep,
):
    urls = [f.url for f in body.items]
    if len(set(urls)) != len(urls):
        raise HTTPException(422, "Each feed address can only be listed once.")
    items = [newsconfig.clean_feed(f.model_dump()) for f in body.items]
    extra = {}
    if body.sections is not None:
        extra["sections"] = newsconfig.clean_names(body.sections)
    await _save(db, newsconfig.FEEDS_KEY, items, session.user_id, **extra)
    await audit(
        db, "settings.news_feeds", session.user_id, client_ip(request),
        count=len(items),
    )  # fmt: skip
    await db.commit()
    return await get_feeds(db, settings)


@router.delete("/api/admin/news/feeds")
async def reset_feeds(
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = AdminDep,
):
    await _save(db, newsconfig.FEEDS_KEY, None, session.user_id)
    await audit(
        db, "settings.news_feeds", session.user_id, client_ip(request),
        reset=True,
    )  # fmt: skip
    await db.commit()
    return await get_feeds(db, settings)


@router.post("/api/admin/news/feeds/test", dependencies=[AdminDep])
async def test_feed(body: TestIn, settings: SettingsDep):
    """Fetch a feed and show what Argus reads from it."""
    url = body.url.strip()
    if not url_allowed(url):
        raise HTTPException(422, "Give the feed's http(s) address.")
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=10.0),
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
            max_redirects=4,
        ) as client:
            r = await client.get(url)
    except httpx.HTTPError as exc:
        return {"ok": False, "error": "Couldn't reach it: {0}.".format(
            type(exc).__name__)}  # fmt: skip
    if r.status_code != 200:
        return {"ok": False, "error": "It answered {0}.".format(r.status_code)}
    if len(r.content) > FEED_MAX_BYTES:
        return {"ok": False, "error": "That's too large to be a feed."}
    try:
        records = parse_feed(body.outlet, r.content, datetime.now(UTC))
    except (ElementTree.ParseError, ValueError):
        return {
            "ok": False,
            "error": "That isn't an RSS or Atom feed (is it the web page?).",
        }
    if not records:
        return {"ok": False, "error": "It's a feed, but has no headlines."}
    newest = max(r_.observed_at for r_ in records)
    return {
        "ok": True,
        "count": len(records),
        "newest": newest.isoformat(),
        "titles": [r_.payload.get("title") for r_ in records[:5]],
    }


@router.get("/api/admin/news/channels", dependencies=[AdminDep])
async def get_channels(db: DbDep):
    items = await newsconfig.channels(db)
    return {
        "items": items,
        "groups": await newsconfig.names(
            db, newsconfig.CHANNELS_KEY, "groups", [c["group"] for c in items]
        ),
        "customised": await newsconfig.customised(db, newsconfig.CHANNELS_KEY),
    }


@router.put("/api/admin/news/channels")
async def put_channels(
    body: ChannelsIn,
    request: Request,
    db: DbDep,
    session: UserSession = AdminDep,
):
    keys = [(c.platform, c.id) for c in body.items]
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "Each channel can only be listed once.")
    for c in body.items:
        if not youtube.valid_channel(c.platform, c.id):
            raise HTTPException(
                422, "{0} isn't a {1} channel ID.".format(c.name, c.platform)
            )
    items = [newsconfig.clean_channel(c.model_dump()) for c in body.items]
    extra = {}
    if body.groups is not None:
        extra["groups"] = newsconfig.clean_names(body.groups)
    await _save(db, newsconfig.CHANNELS_KEY, items, session.user_id, **extra)
    await audit(
        db, "settings.live_channels", session.user_id, client_ip(request),
        count=len(items),
    )  # fmt: skip
    await db.commit()
    return await get_channels(db)


@router.delete("/api/admin/news/channels")
async def reset_channels(
    request: Request, db: DbDep, session: UserSession = AdminDep
):
    await _save(db, newsconfig.CHANNELS_KEY, None, session.user_id)
    await audit(
        db, "settings.live_channels", session.user_id, client_ip(request),
        reset=True,
    )  # fmt: skip
    await db.commit()
    return await get_channels(db)


@router.post("/api/admin/news/channels/lookup", dependencies=[AdminDep])
async def lookup_channel(body: LookupIn, request: Request):
    """A channel's ID, name and live status from a link, @handle or ID."""
    try:
        found = await youtube.lookup_channel(
            request.app.state.youtube, body.input, body.platform
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    found["name"] = html.unescape(found["name"])
    return found
