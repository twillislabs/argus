"""Street-level photos near a spot, from Mapillary (an admin's free
token, key "mapillary" in Data sources; graph.mapillary.com). Photos are
each contributor's under CC BY-SA 4.0; every one is shown with its
author and a link to it on Mapillary. Coverage is good on US roads and
most of the world's, but not everywhere.

Without a token Argus still offers Google Street View for the spot as a
link (no key: it opens Google Maps), which is what most people want in
the US; see the panel.

Images come from Mapillary's CDN through our proxy, which only fetches
image URLs a search has returned (ALLOWED, kept for a while), never
anything a client names.
"""

import asyncio
import math
import time
from urllib.parse import quote

import httpx

SEARCH = "https://graph.mapillary.com/images"
VIEWER = "https://www.mapillary.com/app/?pKey={0}&focus=photo"
FIELDS = (
    "id,captured_at,compass_angle,computed_geometry,geometry,"
    "thumb_256_url,thumb_1024_url,creator"
)
RADIUS_M = 250
LIMIT = 60
SHOWN = 12
CACHE_S = 600
ALLOWED_S = 3600
MAX_ALLOWED = 5000
IMAGE_MAX_BYTES = 6_000_000
LICENCE = "CC BY-SA 4.0"
LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
SOURCE = "Mapillary"


def street_view_url(lat: float, lon: float) -> str:
    """Google Maps' Street View at the nearest panorama (no key)."""
    return (
        "https://www.google.com/maps/@?api=1&map_action=pano"
        "&viewpoint={0:.6f},{1:.6f}"
    ).format(lat, lon)


def _dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lat2 - lat1) * 111_320, (lon2 - lon1) * 111_320 * k)


def _taken(ms) -> str | None:
    if not isinstance(ms, (int, float)):
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def parse_search(doc: dict, lat: float, lon: float) -> list[dict]:
    """Mapillary images as photos, nearest first."""
    out = []
    for f in doc.get("data") or []:
        geo = f.get("computed_geometry") or f.get("geometry") or {}
        coords = geo.get("coordinates") or []
        thumb = str(f.get("thumb_256_url") or "")
        image = str(f.get("thumb_1024_url") or "")
        pid = f.get("id")
        if (
            len(coords) < 2
            or not pid
            or not thumb.startswith("https://")
            or not image.startswith("https://")
        ):
            continue
        heading = f.get("compass_angle")
        creator = f.get("creator") or {}
        out.append(
            {
                "id": str(pid),
                "lat": round(float(coords[1]), 6),
                "lon": round(float(coords[0]), 6),
                "distance_m": round(
                    _dist_m(lat, lon, float(coords[1]), float(coords[0]))
                ),
                "heading": round(float(heading)) % 360
                if isinstance(heading, (int, float))
                else None,
                "taken": _taken(f.get("captured_at")),
                "author": creator.get("username"),
                "licence": LICENCE,
                "licence_url": LICENCE_URL,
                "thumb": thumb,
                "image": image,
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

    async def near(self, lat: float, lon: float, token: str | None) -> dict:
        base = {
            "street_view": street_view_url(lat, lon),
            "source": SOURCE,
        }
        if not token:
            return base | {"status": "nokey", "photos": []}
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
                        "access_token": token,
                        "fields": FIELDS,
                        "bbox": "{0},{1},{2},{3}".format(
                            round(lon - dlon, 6),
                            round(lat - dlat, 6),
                            round(lon + dlon, 6),
                            round(lat + dlat, 6),
                        ),
                        "limit": LIMIT,
                    },
                )
                if r.status_code in (401, 403):
                    return base | {"status": "refused", "photos": []}
                r.raise_for_status()
                photos = parse_search(r.json(), lat, lon)[:SHOWN]
            except (httpx.HTTPError, ValueError):
                return base | {"status": "error", "photos": []}
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
        return base | {
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
