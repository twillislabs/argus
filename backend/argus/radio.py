"""World radio: stations with a location and an HTTPS stream, from
Radio Browser (radio-browser.info, a community directory; its data is
public domain, no key). The most-played STATIONS stations, fetched once
a day and kept in memory; the browser plays a stream straight from the
broadcaster when someone presses play.

Radio Browser runs several mirror servers and asks clients to name
themselves (our User-Agent) and to use more than one.
"""

import asyncio
import time

import httpx

SERVERS = (
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
)
SEARCH = (
    "/json/stations/search?has_geo_info=true&hidebroken=true"
    "&is_https=true&order=clickcount&reverse=true&limit={0}"
)
STATIONS = 1500
TTL_S = 86_400
RETRY_S = 900


def parse_stations(items: list) -> list[dict]:
    out, seen = [], set()
    for s in items:
        url = s.get("url_resolved") or s.get("url") or ""
        lat, lon = s.get("geo_lat"), s.get("geo_long")
        sid = s.get("stationuuid")
        if (
            not sid
            or sid in seen
            or not url.startswith("https://")
            # HLS stations would need hls.js and a looser CSP.
            or s.get("hls")
            or not isinstance(lat, (int, float))
            or not isinstance(lon, (int, float))
            or (lat, lon) == (0, 0)
            or not (-90 <= lat <= 90 and -180 <= lon <= 180)
        ):
            continue
        seen.add(sid)
        homepage = s.get("homepage") or ""
        tags = [t for t in str(s.get("tags") or "").split(",") if t][:6]
        out.append(
            {
                "id": sid,
                "name": str(s.get("name") or "Station").strip()[:100],
                "lat": round(float(lat), 4),
                "lon": round(float(lon), 4),
                "country": s.get("country") or None,
                "state": s.get("state") or None,
                "language": s.get("language") or None,
                "tags": tags,
                "codec": s.get("codec") or None,
                "bitrate": s.get("bitrate") or None,
                "stream": url,
                "homepage": homepage
                if homepage.startswith(("https://", "http://"))
                else None,
            }
        )
    return out


class Radio:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=8.0),
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )
        self.cache: tuple[float, list[dict]] | None = None
        self.failed_at: float | None = None
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def stations(self) -> dict:
        async with self.lock:
            now = time.monotonic()
            if self.cache and now - self.cache[0] < TTL_S:
                return {"status": "ok", "stations": self.cache[1]}
            if self.failed_at is not None and now - self.failed_at < RETRY_S:
                return {
                    "status": "ok" if self.cache else "error",
                    "stations": self.cache[1] if self.cache else [],
                }
            for server in SERVERS:
                try:
                    r = await self.client.get(server + SEARCH.format(STATIONS))
                    r.raise_for_status()
                    found = parse_stations(r.json())
                except (httpx.HTTPError, ValueError):
                    continue
                if found:
                    self.cache = (now, found)
                    self.failed_at = None
                    return {"status": "ok", "stations": found}
            self.failed_at = now
            return {
                "status": "ok" if self.cache else "error",
                "stations": self.cache[1] if self.cache else [],
            }
