"""Automatic licence plate reader (ALPR) cameras mapped in OpenStreetMap,
the dataset DeFlock (deflock.me) maintains: man_made=surveillance with
surveillance:type=ALPR, Flock Safety and other vendors.

Locations only: there's no public plate data and Argus never looks for
any. Fetched from the Overpass API by area for the map view, in 2-degree
tiles, one request at a time, cached a day and shared by every user.
Data (c) OpenStreetMap contributors, ODbL.
"""

import asyncio
import logging
import math
import time

import httpx

log = logging.getLogger("argus.alpr")

OVERPASS = "https://overpass-api.de/api/interpreter"
TILE_DEG = 2
TTL_S = 24 * 3600
# Overpass is busy (429/504): don't ask about that tile again for a while.
BUSY_S = 300
MAX_TILES = 16
NEW_PER_CALL = 2
GAP_S = 1.0
QUERY = (
    "[out:json][timeout:60];"
    'nwr["surveillance:type"="ALPR"]({0},{1},{2},{3});'
    "out center tags;"
)

VENDORS = {
    "flock": "Flock Safety",
    "motorola": "Motorola Solutions",
    "vigilant": "Motorola Solutions",
    "genetec": "Genetec",
    "axis": "Axis",
    "leonardo": "Leonardo",
    "elsag": "Leonardo",
    "neology": "Neology",
    "rekor": "Rekor",
    "ubicquia": "Ubicquia",
}


def vendor(tags: dict) -> str:
    text = " ".join(
        str(tags.get(k) or "")
        for k in ("manufacturer", "brand", "operator:type", "name")
    ).lower()
    for needle, name in VENDORS.items():
        if needle in text:
            return name
    return (tags.get("manufacturer") or tags.get("brand") or "Unknown")[:60]


def direction(tags: dict) -> float | None:
    """Facing, in compass degrees, from direction / camera:direction
    (a number, or a compass point like NE)."""
    points = {
        "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5,
        "SE": 135, "SSE": 157.5, "S": 180, "SSW": 202.5, "SW": 225,
        "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
    }  # fmt: skip
    raw = str(tags.get("camera:direction") or tags.get("direction") or "")
    first = raw.split(";")[0].split("-")[0].strip().upper()
    if not first:
        return None
    if first in points:
        return float(points[first])
    try:
        return float(first) % 360
    except ValueError:
        return None


def normalise(el: dict) -> dict | None:
    tags = el.get("tags") or {}
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        return None
    kind = el.get("type", "node")
    return {
        "id": "{0}/{1}".format(kind, el.get("id")),
        "lat": round(float(lat), 6),
        "lon": round(float(lon), 6),
        "vendor": vendor(tags),
        "operator": (tags.get("operator") or "")[:120] or None,
        "direction": direction(tags),
        "zone": tags.get("surveillance:zone"),
        "mapped": tags.get("check_date")
        or tags.get("survey:date")
        or tags.get("start_date"),
        "osm_url": "https://www.openstreetmap.org/{0}/{1}".format(
            kind, el.get("id")
        ),
    }


def tiles(bbox) -> list[tuple[int, int]] | None:
    """2-degree tiles covering a bbox, or None if there are too many."""
    w, s, e, n = bbox
    if w > e:
        return None
    # A box ending exactly on a tile edge doesn't need the next tile.
    x0, y0 = math.floor(w / TILE_DEG), math.floor(s / TILE_DEG)
    xs = range(x0, max(x0 + 1, math.ceil(e / TILE_DEG)))
    ys = range(y0, max(y0 + 1, math.ceil(n / TILE_DEG)))
    out = [(x, y) for x in xs for y in ys]
    return out if len(out) <= MAX_TILES else None


class Busy(Exception):
    """Overpass is out of capacity for us right now."""


class Alpr:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(70.0, connect=10.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: dict[tuple[int, int], tuple[float, list[dict]]] = {}
        self.busy_until: dict[tuple[int, int], float] = {}
        self.lock = asyncio.Lock()
        self.last = 0.0

    async def close(self) -> None:
        await self.client.aclose()

    async def tile(self, tile: tuple[int, int]) -> list[dict]:
        hit = self.cache.get(tile)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
        if self.busy_until.get(tile, 0) > time.time():
            raise Busy()
        async with self.lock:
            # Someone else may have fetched it while we waited.
            hit = self.cache.get(tile)
            if hit and time.time() - hit[0] < TTL_S:
                return hit[1]
            wait = self.last + GAP_S - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            x, y = tile
            query = QUERY.format(
                y * TILE_DEG,
                x * TILE_DEG,
                (y + 1) * TILE_DEG,
                (x + 1) * TILE_DEG,
            )
            try:
                r = await self.client.post(OVERPASS, data={"data": query})
            finally:
                self.last = time.monotonic()
            if r.status_code in (429, 503, 504):
                self.busy_until[tile] = time.time() + BUSY_S
                raise Busy()
            r.raise_for_status()
            items = [
                c
                for c in (normalise(el) for el in r.json().get("elements", []))
                if c is not None
            ]
            self.cache[tile] = (time.time(), items)
            if len(self.cache) > 3000:
                oldest = min(self.cache, key=lambda k: self.cache[k][0])
                self.cache.pop(oldest, None)
            return items

    def cached(self, tile: tuple[int, int]) -> list[dict] | None:
        hit = self.cache.get(tile)
        return hit[1] if hit and time.time() - hit[0] < TTL_S else None

    async def area(self, bbox) -> tuple[list[dict], bool] | None:
        """Cameras in a bbox, and whether every tile is in; None if the
        view is too big. Cached tiles come back at once; at most
        NEW_PER_CALL missing ones are fetched, so a call stays short and
        the map asks again for the rest."""
        covering = tiles(bbox)
        if covering is None:
            return None
        w, s, e, n = bbox
        out, complete, fetched = [], True, 0
        for t in covering:
            items = self.cached(t)
            if items is None:
                if fetched >= NEW_PER_CALL:
                    complete = False
                    continue
                fetched += 1
                try:
                    items = await self.tile(t)
                except (Busy, httpx.HTTPError, ValueError):
                    complete = False
                    continue
            out += [
                c for c in items if w <= c["lon"] <= e and s <= c["lat"] <= n
            ]
        return out, complete
