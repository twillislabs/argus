"""Live stream IDs for the news player.

YouTube no longer plays embed/live_stream?channel=... (it treats
"live_stream" as a video ID), so the player embeds the video itself. A
channel's /live page names its current live video as the canonical URL;
when the channel isn't live, the canonical URL is the channel.

Lookups are cached per channel (ten minutes when live, five when not), so
however many people watch, each channel's page is fetched rarely.
"""

import asyncio
import re
import time

import httpx

CHANNEL_RE = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
LIVE_PAGE = "https://www.youtube.com/channel/{0}/live"
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

    async def resolve(self, channel: str) -> dict:
        hit = self._cache.get(channel)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        lock = self._locks.setdefault(channel, asyncio.Lock())
        async with lock:
            hit = self._cache.get(channel)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            async with self._gate:
                result, ttl = await self._fetch(channel)
            self._cache[channel] = (time.monotonic() + ttl, result)
            return result

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
