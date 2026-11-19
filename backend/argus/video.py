"""Video near a place, with an admin's keys (Settings > Data sources):

- YouTube Data API v3 search.list (key "youtube"): live streams within a
  radius of a point (type=video, eventType=live, location,
  locationRadius up to 1000 km), and recent videos about an event (its
  place and kind of event in the query, published since it began). A
  search spends the key's small daily quota, so it only runs when
  someone asks, and answers are cached and shared.
- Windy Webcams API v3 (key "windy", header x-windy-api-key): webcams
  near a point, with their preview image, location, page and timelapse
  player. Windy's terms: link every image to its webcam page or player,
  credit "Webcams provided by windy.com", use only the URLs the API
  gives (free-tier image URLs expire after 10-15 minutes, so answers are
  cached for less than that). Its response fields are read defensively.
"""

import logging
import re
import time
from datetime import UTC, datetime, timedelta

import httpx

log = logging.getLogger("argus.video")

YT_SEARCH = "https://www.googleapis.com/youtube/v3/search"
WINDY = "https://api.windy.com/webcams/api/v3/webcams"
NEAR_TTL_S = 1800  # YouTube live near a place
EVENT_TTL_S = 3600  # YouTube videos about an event
WEBCAM_TTL_S = 480  # under Windy's free-tier image URL lifetime
MAX_RADIUS_KM = 250
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


class NoKey(Exception):
    """The admin hasn't added the key yet."""


class Quota(Exception):
    """YouTube says the key's daily quota is used up."""


def _clean(text: str | None, limit: int) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()[:limit]


def parse_youtube(doc: dict, live: bool) -> list[dict]:
    out = []
    for item in doc.get("items") or []:
        vid = (item.get("id") or {}).get("videoId")
        if not vid or not VIDEO_ID.match(vid):
            continue
        sn = item.get("snippet") or {}
        out.append(
            {
                "id": vid,
                "title": _clean(sn.get("title"), 200),
                "channel": _clean(sn.get("channelTitle"), 120),
                "published": sn.get("publishedAt"),
                "live": live or sn.get("liveBroadcastContent") == "live",
                "thumb": "https://i.ytimg.com/vi/{0}/mqdefault.jpg".format(
                    vid
                ),
                "url": "https://www.youtube.com/watch?v={0}".format(vid),
            }
        )
    return out


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_windy(doc: dict) -> list[dict]:
    out = []
    for w in doc.get("webcams") or []:
        loc = w.get("location") or {}
        lat, lon = _num(loc.get("latitude")), _num(loc.get("longitude"))
        wid = w.get("webcamId") or w.get("id")
        if lat is None or lon is None or wid is None:
            continue
        images = w.get("images") or {}
        current = images.get("current") or {}
        image = current.get("preview") or current.get("thumbnail") or ""
        player = w.get("player") or {}
        urls = w.get("urls") or {}
        place = ", ".join(
            x
            for x in (loc.get("city"), loc.get("region"), loc.get("country"))
            if x
        )
        out.append(
            {
                "id": "windy-{0}".format(
                    re.sub(r"[^0-9A-Za-z]", "", str(wid))
                ),
                "title": _clean(w.get("title"), 160) or "Webcam",
                "place": place[:160] or None,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "status": w.get("status"),
                "image": image if image.startswith("https://") else None,
                "player": next(
                    (
                        player[k]
                        for k in ("live", "day", "month", "lifetime", "year")
                        if isinstance(player.get(k), str)
                        and player[k].startswith("https://")
                    ),
                    None,
                ),
                "page": urls.get("detail")
                if isinstance(urls.get("detail"), str)
                else None,
                "updated": w.get("lastUpdatedOn"),
            }
        )
    if doc.get("webcams") and not out:
        log.warning(
            "Windy: no webcams parsed; first keys: {0}".format(
                sorted(doc["webcams"][0])[:20]
            )
        )
    return out


class Video:
    """Shared, cached lookups for every user."""

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: dict[str, tuple[float, list[dict]]] = {}

    async def close(self) -> None:
        await self.client.aclose()

    def _hit(self, key: str, ttl: float) -> list[dict] | None:
        hit = self.cache.get(key)
        return hit[1] if hit and time.monotonic() - hit[0] < ttl else None

    def _put(self, key: str, value: list[dict]) -> list[dict]:
        self.cache[key] = (time.monotonic(), value)
        if len(self.cache) > 500:
            oldest = min(self.cache, key=lambda k: self.cache[k][0])
            self.cache.pop(oldest, None)
        return value

    async def _youtube(self, key: str | None, params: dict, live: bool):
        if not key:
            raise NoKey()
        r = await self.client.get(
            YT_SEARCH,
            params={
                "part": "snippet",
                "type": "video",
                "maxResults": 15,
                "safeSearch": "strict",
                "key": key,
                **params,
            },
        )
        if r.status_code == 403 and "quota" in r.text.lower():
            raise Quota()
        r.raise_for_status()
        return parse_youtube(r.json(), live)

    async def live_near(
        self, key: str | None, lat: float, lon: float, radius_km: int
    ) -> list[dict]:
        radius = max(5, min(MAX_RADIUS_KM, int(radius_km)))
        # Rounded so people looking at the same area share an answer.
        ck = "near:{0:.1f},{1:.1f},{2}".format(lat, lon, radius)
        hit = self._hit(ck, NEAR_TTL_S)
        if hit is not None:
            return hit
        found = await self._youtube(
            key,
            {
                "eventType": "live",
                "location": "{0:.4f},{1:.4f}".format(lat, lon),
                "locationRadius": "{0}km".format(radius),
                "order": "viewCount",
            },
            live=True,
        )
        return self._put(ck, found)

    async def about_event(
        self,
        key: str | None,
        event_id: str,
        query: str,
        since: datetime,
        lat: float | None,
        lon: float | None,
    ) -> list[dict]:
        ck = "event:{0}".format(event_id)
        hit = self._hit(ck, EVENT_TTL_S)
        if hit is not None:
            return hit
        params = {
            "q": query[:200],
            "order": "date",
            "publishedAfter": (since - timedelta(hours=6))
            .astimezone(UTC)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if lat is not None and lon is not None:
            params["location"] = "{0:.4f},{1:.4f}".format(lat, lon)
            params["locationRadius"] = "100km"
        found = await self._youtube(key, params, live=False)
        if not found and "location" in params:
            # Few uploads carry a location: try the words alone.
            params.pop("location")
            params.pop("locationRadius")
            found = await self._youtube(key, params, live=False)
        return self._put(ck, found)

    async def webcams_near(
        self, key: str | None, lat: float, lon: float, radius_km: int
    ) -> list[dict]:
        if not key:
            raise NoKey()
        radius = max(5, min(MAX_RADIUS_KM, int(radius_km)))
        ck = "windy:{0:.1f},{1:.1f},{2}".format(lat, lon, radius)
        hit = self._hit(ck, WEBCAM_TTL_S)
        if hit is not None:
            return hit
        r = await self.client.get(
            WINDY,
            params={
                "nearby": "{0:.4f},{1:.4f},{2}".format(lat, lon, radius),
                "include": "images,location,player,urls",
                "limit": 50,
            },
            headers={"x-windy-api-key": key},
        )
        r.raise_for_status()
        return self._put(ck, parse_windy(r.json()))


def now() -> datetime:
    return datetime.now(UTC)
