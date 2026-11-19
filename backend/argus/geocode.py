"""Address search through OpenStreetMap's Nominatim (public instance,
no key). Its usage policy: at most one request a second, an identifying
User-Agent (ARGUS_USER_AGENT; include a contact), no autocomplete, and
cache results. So Argus only asks when someone presses Enter on "Find
address", queues requests a second apart for the whole server, and
keeps answers a week. Data © OpenStreetMap contributors (ODbL).
"""

import asyncio
import logging
import time

import httpx

log = logging.getLogger("argus.geocode")

URL = "https://nominatim.openstreetmap.org/search"
SPACING_S = 1.1
CACHE_S = 7 * 86400
CACHE_MAX = 2000
MAX_WAITING = 10
ATTRIBUTION = "© OpenStreetMap contributors (Nominatim)"


class Busy(Exception):
    """Too many lookups queued: try again in a moment."""


def _height(kind: str, cls: str) -> int:
    """How high to put the camera: low for a house, higher for a road or
    an area."""
    if cls in ("building", "amenity", "shop", "office", "tourism") or kind in (
        "house",
        "residential",
    ):
        return 900
    if cls == "highway":
        return 2500
    if cls == "boundary" or kind in ("city", "town", "administrative"):
        return 25000
    return 4000


def parse(rows: list) -> list[dict]:
    out = []
    for r in rows if isinstance(rows, list) else []:
        try:
            lat, lon = float(r["lat"]), float(r["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        name = str(r.get("display_name") or "").strip()
        if not name:
            continue
        first, _, rest = name.partition(", ")
        out.append(
            {
                "kind": "address",
                "label": first[:120],
                "detail": rest[:200],
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "height_m": _height(
                    str(r.get("type") or ""),
                    str(r.get("category") or r.get("class") or ""),
                ),
            }
        )
    return out


class Geocoder:
    """Shared by every user: one Nominatim request at a time, a second
    apart, answers cached."""

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: dict[str, tuple[float, list[dict]]] = {}
        self.lock = asyncio.Lock()
        self.last = 0.0
        self.waiting = 0

    async def close(self) -> None:
        await self.client.aclose()

    async def search(self, query: str, lang: str | None = None) -> list[dict]:
        key = " ".join(query.lower().split())
        hit = self.cache.get(key)
        if hit and time.time() - hit[0] < CACHE_S:
            return hit[1]
        if self.waiting >= MAX_WAITING:
            raise Busy()
        self.waiting += 1
        try:
            async with self.lock:
                hit = self.cache.get(key)
                if hit and time.time() - hit[0] < CACHE_S:
                    return hit[1]
                wait = self.last + SPACING_S - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                try:
                    r = await self.client.get(
                        URL,
                        params={"q": query, "format": "jsonv2", "limit": 6},
                        headers={"Accept-Language": lang or "en"},
                    )
                finally:
                    self.last = time.monotonic()
                r.raise_for_status()
                found = parse(r.json())
        finally:
            self.waiting -= 1
        self.cache[key] = (time.time(), found)
        if len(self.cache) > CACHE_MAX:
            oldest = min(self.cache, key=lambda k: self.cache[k][0])
            self.cache.pop(oldest, None)
        return found
