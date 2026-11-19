"""Live stream IDs for the news player (YouTube and Rumble).

YouTube no longer plays embed/live_stream?channel=... (it treats
"live_stream" as a video ID), so the player embeds the video itself. A
channel's /live page names its current live video as the canonical URL;
when the channel isn't live, the canonical URL is the channel.

Rumble (for channels not on YouTube): the channel's livestreams page
carries its video list as JSON; a live stream there is looked up through
Rumble's oEmbed for the ID its embed player uses.

Lookups are cached per channel (ten minutes when live, five when not), so
however many people watch, each channel's page is fetched rarely.
"""

import asyncio
import json
import re
import time

import httpx

CHANNEL_RE = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
RUMBLE_RE = re.compile(r"^[A-Za-z0-9_-]{2,60}$")
LIVE_PAGE = "https://www.youtube.com/channel/{0}/live"
RUMBLE_LIVE = "https://rumble.com/c/{0}/livestreams"
RUMBLE_OEMBED = "https://rumble.com/api/Media/oembed.json"
RUMBLE_GRID = re.compile(
    r'<rum-videos-grid>\s*<script type="application/json">(.*?)</script>',
    re.S,
)
RUMBLE_EMBED = re.compile(r"https://rumble\.com/embed/(v[a-z0-9]+)/")
CANONICAL = re.compile(
    r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v='
    r'([A-Za-z0-9_-]{11})"'
)
LIVE_TTL_S = 600
OFFLINE_TTL_S = 300
ERROR_TTL_S = 60


def parse_live(page: str) -> str | None:
    """The live video ID on a channel's /live page, or None."""
    m = CANONICAL.search(page)
    if not m or '"isLive":true' not in page:
        return None
    return m.group(1)


def parse_rumble_live(page: str) -> str | None:
    """The URL of the channel's stream that is live now, or None."""
    m = RUMBLE_GRID.search(page)
    if not m:
        return None
    try:
        items = json.loads(m.group(1)).get("items", [])
    except ValueError:
        return None
    for item in items:
        # livestream_status 2 is on air (1 upcoming, 0 ended).
        if item.get("live") and item.get("livestream_status") == 2:
            url = str(item.get("url") or "")
            if url.startswith("https://rumble.com/v"):
                return url
    return None


def valid_channel(platform: str, channel: str) -> bool:
    if platform == "youtube":
        return bool(CHANNEL_RE.match(channel))
    if platform == "rumble":
        return bool(RUMBLE_RE.match(channel))
    return False


class LiveIds:
    def __init__(self, user_agent: str) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=10.0),
            headers={"User-Agent": user_agent, "Accept-Language": "en"},
            # Skips the EU consent interstitial, which has no canonical.
            cookies={"CONSENT": "YES+"},
            follow_redirects=True,
        )
        self._cache: dict[str, tuple[float, dict]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        # A few at a time: the pages are over a megabyte each.
        self._gate = asyncio.Semaphore(3)

    async def close(self) -> None:
        await self._client.aclose()

    async def resolve(self, channel: str, platform: str = "youtube") -> dict:
        key = "{0}:{1}".format(platform, channel)
        hit = self._cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            fetch = self._fetch if platform == "youtube" else self._rumble
            async with self._gate:
                result, ttl = await fetch(channel)
            result["platform"] = platform
            self._cache[key] = (time.monotonic() + ttl, result)
            return result

    async def _rumble(self, channel: str) -> tuple[dict, int]:
        try:
            response = await self._client.get(RUMBLE_LIVE.format(channel))
            if response.status_code != 200:
                return {"status": "error", "video_id": None}, ERROR_TTL_S
            url = parse_rumble_live(response.text)
            if url is None:
                return {"status": "offline", "video_id": None}, OFFLINE_TTL_S
            oembed = await self._client.get(RUMBLE_OEMBED, params={"url": url})
            m = RUMBLE_EMBED.search(oembed.json().get("html", ""))
        except (httpx.HTTPError, ValueError):
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        if not m:
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        return {"status": "live", "video_id": m.group(1)}, LIVE_TTL_S

    async def _fetch(self, channel: str) -> tuple[dict, int]:
        try:
            response = await self._client.get(LIVE_PAGE.format(channel))
        except httpx.HTTPError:
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        if response.status_code != 200:
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        video = parse_live(response.text)
        if video is None:
            return {"status": "offline", "video_id": None}, OFFLINE_TTL_S
        return {"status": "live", "video_id": video}, LIVE_TTL_S
