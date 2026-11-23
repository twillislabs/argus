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
# Dailymotion user names and Kick channel slugs.
DM_RE = re.compile(r"^[A-Za-z0-9_-]{2,60}$")
KICK_RE = re.compile(r"^[A-Za-z0-9_-]{2,40}$")
DM_LIVE = "https://api.dailymotion.com/user/{0}/videos"
DM_USER = "https://api.dailymotion.com/user/{0}"
DM_VIDEO = re.compile(r"^x[a-z0-9]{3,12}$")
PLATFORMS = ("youtube", "rumble", "dailymotion", "kick")
PLATFORM_PATTERN = "^(youtube|rumble|dailymotion|kick)$"
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


UPCOMING_WINDOW = 12000
SCHEDULED = re.compile(r'"scheduledStartTime":"(\d{9,11})"')


def _details(page: str, video: str) -> str:
    """The stretch of the page describing that video (its videoDetails)."""
    i = page.find('"videoDetails":{{"videoId":"{0}"'.format(video))
    return page[i : i + UPCOMING_WINDOW] if i >= 0 else ""


def parse_upcoming(page: str) -> int | None:
    """When the /live page's video is scheduled, not on air: its start
    (Unix seconds), else None."""
    m = CANONICAL.search(page)
    if not m or '"isUpcoming":true' not in _details(page, m.group(1)):
        return None
    s = SCHEDULED.search(page)
    return int(s.group(1)) if s else 0


def parse_live(page: str) -> str | None:
    """The live video ID on a channel's /live page, or None. A scheduled
    stream isn't live: its page also says "isLive" (for the "waiting"
    count), so check the video's own details for isUpcoming."""
    m = CANONICAL.search(page)
    if not m or '"isLive":true' not in page:
        return None
    if '"isUpcoming":true' in _details(page, m.group(1)):
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
    if platform == "dailymotion":
        return bool(DM_RE.match(channel))
    if platform == "kick":
        return bool(KICK_RE.match(channel))
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
            fetch = {
                "rumble": self._rumble,
                "dailymotion": self._dailymotion,
                "kick": self._kick,
            }.get(platform, self._fetch)
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

    async def _dailymotion(self, channel: str) -> tuple[dict, int]:
        """Dailymotion's public API (no key): the user's video on air."""
        try:
            r = await self._client.get(
                DM_LIVE.format(channel),
                params={"live_onair": "1", "fields": "id", "limit": "1"},
            )
            if r.status_code == 404:
                return {"status": "error", "video_id": None}, ERROR_TTL_S
            r.raise_for_status()
            found = r.json().get("list") or []
        except (httpx.HTTPError, ValueError):
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        vid = found[0].get("id") if found else None
        if not vid or not DM_VIDEO.match(str(vid)):
            return {"status": "offline", "video_id": None}, OFFLINE_TTL_S
        return {"status": "live", "video_id": vid}, LIVE_TTL_S

    async def _kick(self, channel: str) -> tuple[dict, int]:
        """Kick's player embeds a channel by its slug and shows its own
        offline screen; its API needs a signed-in user, so Argus doesn't
        ask whether the channel is live."""
        return {
            "status": "live",
            "video_id": channel,
            "unverified": True,
        }, LIVE_TTL_S

    async def _fetch(self, channel: str) -> tuple[dict, int]:
        try:
            response = await self._client.get(LIVE_PAGE.format(channel))
        except httpx.HTTPError:
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        if response.status_code != 200:
            return {"status": "error", "video_id": None}, ERROR_TTL_S
        video = parse_live(response.text)
        if video is None:
            starts = parse_upcoming(response.text)
            if starts is not None:
                return {
                    "status": "upcoming",
                    "video_id": None,
                    "starts_at": starts or None,
                }, OFFLINE_TTL_S
            return {"status": "offline", "video_id": None}, OFFLINE_TTL_S
        return {"status": "live", "video_id": video}, LIVE_TTL_S


# --- looking up a channel an admin adds --------------------------------

HANDLE_RE = re.compile(r"^@?([A-Za-z0-9._-]{3,30})$")
CHANNEL_IN_URL = re.compile(r"youtube\.com/channel/(UC[A-Za-z0-9_-]{22})")
HANDLE_IN_URL = re.compile(r"youtube\.com/@([A-Za-z0-9._-]{3,30})")
RUMBLE_IN_URL = re.compile(r"rumble\.com/(?:c/|user/)?([A-Za-z0-9_-]{2,60})")
DM_IN_URL = re.compile(r"dailymotion\.com/(?!video/)([A-Za-z0-9_-]{2,60})")
KICK_IN_URL = re.compile(r"kick\.com/([A-Za-z0-9_-]{2,40})")
PAGE_CHANNEL_ID = re.compile(
    r'(?:"externalId"|"channelId"|"browseId"):"(UC[A-Za-z0-9_-]{22})"'
)
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={0}"
FEED_TITLE = re.compile(r"<title>([^<]{1,120})</title>")
HANDLE_PAGE = "https://www.youtube.com/@{0}"


def parse_channel_input(text: str) -> tuple[str, str] | None:
    """What an admin typed, as ("youtube", "UC...") or ("handle", name)
    or ("rumble", name); None when it can't be one."""
    t = text.strip()
    if CHANNEL_RE.match(t):
        return ("youtube", t)
    m = CHANNEL_IN_URL.search(t)
    if m:
        return ("youtube", m.group(1))
    m = HANDLE_IN_URL.search(t)
    if m:
        return ("handle", m.group(1))
    if "rumble.com" in t:
        m = RUMBLE_IN_URL.search(t)
        return ("rumble", m.group(1)) if m else None
    if "dailymotion.com" in t:
        m = DM_IN_URL.search(t)
        return ("dailymotion", m.group(1)) if m else None
    if "kick.com" in t:
        m = KICK_IN_URL.search(t)
        return ("kick", m.group(1).lower()) if m else None
    if t.startswith("@"):
        m = HANDLE_RE.match(t)
        return ("handle", m.group(1)) if m else None
    return None


async def lookup_channel(ids: LiveIds, text: str, platform: str) -> dict:
    """The channel ID, name and live status for something an admin
    typed (a channel ID, a channel or @handle link, or a Rumble channel).
    Raises ValueError with a message for people."""
    if platform in ("rumble", "dailymotion", "kick") and valid_channel(
        platform, text.strip()
    ):
        kind, value = platform, text.strip()
        if kind == "kick":
            value = value.lower()
    else:
        found = parse_channel_input(text)
        if found is None:
            raise ValueError(
                "Paste a YouTube channel link, an @handle, a channel ID "
                "(UC...), or a Rumble, Dailymotion or Kick channel link."
            )
        kind, value = found
    client = ids._client
    if kind == "handle":
        try:
            page = await client.get(HANDLE_PAGE.format(value))
        except httpx.HTTPError as exc:
            raise ValueError("YouTube didn't answer.") from exc
        m = (
            PAGE_CHANNEL_ID.search(page.text)
            if page.status_code == 200
            else None
        )
        if not m:
            raise ValueError("No YouTube channel @{0}.".format(value))
        kind, value = "youtube", m.group(1)
    name = None
    if kind == "youtube":
        try:
            feed = await client.get(FEED_URL.format(value))
        except httpx.HTTPError as exc:
            raise ValueError("YouTube didn't answer.") from exc
        if feed.status_code != 200:
            raise ValueError("YouTube has no channel {0}.".format(value))
        m = FEED_TITLE.search(feed.text)
        name = m.group(1).strip() if m else None
    if kind == "dailymotion":
        try:
            r = await client.get(
                DM_USER.format(value), params={"fields": "screenname"}
            )
        except httpx.HTTPError as exc:
            raise ValueError("Dailymotion didn't answer.") from exc
        if r.status_code != 200:
            raise ValueError("Dailymotion has no channel {0}.".format(value))
        name = (r.json().get("screenname") or "").strip() or None
    live = await ids.resolve(value, kind)
    if kind == "rumble" and live.get("status") == "error":
        raise ValueError("Rumble has no channel {0}.".format(value))
    return {
        "id": value,
        "platform": kind,
        "name": name or value,
        "status": live.get("status"),
        "starts_at": live.get("starts_at"),
    }
