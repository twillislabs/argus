"""Street-level photos near a spot, from Panoramax (the federated, open
street-imagery catalogue: api.panoramax.xyz, no key). Photos are each
contributor's, mostly CC BY-SA 4.0; every one is shown with its author,
licence and a link to it on Panoramax.

Images live on many Panoramax instances, so the browser gets them
through our proxy; the proxy only fetches image URLs a search has
returned (ALLOWED, kept for a while), never anything a client names.
"""

import asyncio
import math
import time
from urllib.parse import quote

import httpx

SEARCH = "https://api.panoramax.xyz/api/search"
VIEWER = "https://api.panoramax.xyz/#focus=pic&pic={0}"
RADIUS_M = 250
LIMIT = 40
SHOWN = 12
CACHE_S = 600
ALLOWED_S = 3600
MAX_ALLOWED = 5000
IMAGE_MAX_BYTES = 6_000_000


def _dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lat2 - lat1) * 111_320, (lon2 - lon1) * 111_320 * k)


def parse_search(doc: dict, lat: float, lon: float) -> list[dict]:
    """Panoramax search features as photos, nearest first."""
    out = []
    for f in doc.get("features") or []:
        p = f.get("properties") or {}
        coords = (f.get("geometry") or {}).get("coordinates") or []
        assets = f.get("assets") or {}
        thumb = (assets.get("thumb") or {}).get("href")
        sd = (assets.get("sd") or {}).get("href")
        pid = f.get("id")
        if (
            len(coords) < 2
            or not pid
            or not str(thumb or "").startswith("https://")
            or not str(sd or "").startswith("https://")
            or p.get("geovisio:status", "ready") != "ready"
        ):
            continue
        licence = next(
            (
                (link.get("href"), link.get("title"))
                for link in f.get("links") or []
                if link.get("rel") == "license"
            ),
            (None, None),
        )
        azimuth = p.get("view:azimuth")
        out.append(
            {
                "id": str(pid),
                "lat": round(float(coords[1]), 6),
                "lon": round(float(coords[0]), 6),
                "distance_m": round(
                    _dist_m(lat, lon, float(coords[1]), float(coords[0]))
                ),
                "heading": round(float(azimuth))
                if isinstance(azimuth, (int, float))
                else None,
                "taken": p.get("datetimetz") or p.get("datetime"),
                "author": p.get("geovisio:producer"),
                "licence": p.get("license"),
                "licence_url": licence[0],
                "thumb": thumb,
                "image": sd,
                "link": VIEWER.format(pid),
            }
        )
    out.sort(key=lambda x: x["distance_m"])
    return out


class StreetPhotos:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=6.0),
            headers={"User-Agent": user_agent},
            follow_redirects=False,
        )
        self.cache: dict[tuple[float, float], tuple[float, list]] = {}
        # Image URLs a search returned -> when.
        self.allowed: dict[str, float] = {}
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def near(self, lat: float, lon: float) -> dict:
        key = (round(lat, 4), round(lon, 4))
        hit = self.cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_S:
            photos = hit[1]
        else:
            dlat = RADIUS_M / 111_320
            dlon = dlat / max(0.05, math.cos(math.radians(lat)))
            try:
                r = await self.client.get(
                    SEARCH,
                    params={
                        "bbox": "{0},{1},{2},{3}".format(
                            round(lon - dlon, 6),
                            round(lat - dlat, 6),
                            round(lon + dlon, 6),
                            round(lat + dlat, 6),
                        ),
                        "limit": LIMIT,
                    },
                )
                r.raise_for_status()
                photos = parse_search(r.json(), lat, lon)[:SHOWN]
            except (httpx.HTTPError, ValueError):
                return {"status": "error", "photos": []}
            self.cache[key] = (time.monotonic(), photos)
            if len(self.cache) > 500:
                self.cache.pop(next(iter(self.cache)))
        now = time.monotonic()
        async with self.lock:
            for p in photos:
                self.allowed[p["thumb"]] = now
                self.allowed[p["image"]] = now
            if len(self.allowed) > MAX_ALLOWED:
                for k in sorted(self.allowed, key=self.allowed.get)[
                    : len(self.allowed) - MAX_ALLOWED
                ]:
                    del self.allowed[k]
        return {
            "status": "ok",
            "photos": [
                p
                | {
                    "thumb": "/api/streetphotos/image?u={0}".format(
                        _quote(p["thumb"])
                    ),
                    "image": "/api/streetphotos/image?u={0}".format(
                        _quote(p["image"])
                    ),
                }
                for p in photos
            ],
            "source": "Panoramax",
        }

    def is_allowed(self, url: str) -> bool:
        at = self.allowed.get(url)
        return at is not None and time.monotonic() - at < ALLOWED_S

    async def image(self, url: str) -> tuple[bytes, str] | None:
        if not self.is_allowed(url):
            return None
        r = await self.client.get(url)
        kind = r.headers.get("content-type", "").split(";")[0]
        if (
            r.status_code != 200
            or not kind.startswith("image/")
            or len(r.content) > IMAGE_MAX_BYTES
        ):
            raise httpx.HTTPError("no image")
        return r.content, kind


def _quote(url: str) -> str:
    return quote(url, safe="")
