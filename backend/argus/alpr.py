"""Automatic licence plate reader (ALPR) cameras mapped in OpenStreetMap,
the dataset DeFlock (deflock.me) maintains: man_made=surveillance with
surveillance:type=ALPR, Flock Safety and other vendors.

Locations only: there's no public plate data and Argus never looks for
any. Fetched from the Overpass API by area for the map view, in 1-degree
tiles, one request at a time, in the background, and kept a day in the
database (alpr_tiles) so restarts don't refetch. When the main Overpass
server is busy or failing, a second public instance is tried.
Data (c) OpenStreetMap contributors, ODbL.
"""

import asyncio
import logging
import math
import time

import httpx

log = logging.getLogger("argus.alpr")

OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
TILE_DEG = 1
# Mapping changes slowly: a fetched tile is good for a week.
TTL_S = 7 * 24 * 3600
# Overpass is busy (429/504): don't ask about that tile again for a while.
BUSY_S = 300
MAX_TILES = 36
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


# Tags worth a label in the camera panel, in order; the rest are listed
# as they are.
TAG_MAX = 40


def directions(tags: dict) -> list[float]:
    raw = str(tags.get("camera:direction") or tags.get("direction") or "")
    out = []
    for part in raw.split(";"):
        b = direction({"direction": part})
        if b is not None:
            out.append(b)
    return out[:8]


def clean_tags(tags: dict) -> dict:
    """Every mapped tag except translated names, values trimmed."""
    out = {}
    for k in sorted(tags):
        if k.startswith("name:") or len(out) >= TAG_MAX:
            continue
        out[k[:60]] = str(tags[k])[:200]
    return out


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
        "directions": directions(tags),
        "zone": tags.get("surveillance:zone"),
        "operator_type": tags.get("operator:type"),
        "mount": tags.get("camera:mount") or tags.get("support"),
        "model": tags.get("model") or tags.get("camera:type"),
        "tags": clean_tags(tags),
        "mapped": tags.get("check_date")
        or tags.get("survey:date")
        or tags.get("start_date"),
        "osm_url": "https://www.openstreetmap.org/{0}/{1}".format(
            kind, el.get("id")
        ),
        "deflock_url": "https://maps.deflock.org/#map=18/{0:.6f}/{1:.6f}".format(
            float(lat), float(lon)
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
    def __init__(self, user_agent: str, db=None) -> None:
        # db: argus.db.Database, for the day-long tile store (optional).
        self.db = db
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(70.0, connect=10.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: dict[tuple[int, int], tuple[float, list[dict]]] = {}
        self.busy_until: dict[tuple[int, int], float] = {}
        # One request at a time per Overpass server (their limit is per
        # client), spaced GAP_S apart; two servers, so two tiles at once.
        self.locks = {s: asyncio.Lock() for s in OVERPASS}
        self.last = {s: 0.0 for s in OVERPASS}
        self.pending: dict[tuple[int, int], asyncio.Task] = {}

    async def close(self) -> None:
        for task in list(self.pending.values()):
            task.cancel()
        await self.client.aclose()

    async def tile(self, tile: tuple[int, int]) -> list[dict]:
        hit = self.cache.get(tile)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
        if self.busy_until.get(tile, 0) > time.time():
            raise Busy()
        x, y = tile
        query = QUERY.format(
            y * TILE_DEG, x * TILE_DEG, (y + 1) * TILE_DEG, (x + 1) * TILE_DEG
        )
        # Spread tiles over the servers; the other one is the fallback.
        first = (x + y) % len(OVERPASS)
        order = OVERPASS[first:] + OVERPASS[:first]
        r = None
        for server in order:
            async with self.locks[server]:
                hit = self.cache.get(tile)  # fetched while we waited?
                if hit and time.time() - hit[0] < TTL_S:
                    return hit[1]
                wait = self.last[server] + GAP_S - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
                try:
                    r = await self.client.post(server, data={"data": query})
                except httpx.HTTPError:
                    r = None
                    continue
                finally:
                    self.last[server] = time.monotonic()
            if r.status_code == 200:
                break
        if r is None or r.status_code in (429, 503, 504):
            self.busy_until[tile] = time.time() + BUSY_S
            raise Busy()
        r.raise_for_status()
        items = [
            c
            for c in (normalise(el) for el in r.json().get("elements", []))
            if c is not None
        ]
        self.cache[tile] = (time.time(), items)
        await self._store(tile, items)
        if len(self.cache) > 3000:
            oldest = min(self.cache, key=lambda k: self.cache[k][0])
            self.cache.pop(oldest, None)
        return items

    def cached(self, tile: tuple[int, int]) -> list[dict] | None:
        hit = self.cache.get(tile)
        return hit[1] if hit and time.time() - hit[0] < TTL_S else None

    @staticmethod
    def _key(tile: tuple[int, int]) -> str:
        return "{0}:{1}:{2}".format(TILE_DEG, tile[0], tile[1])

    async def _store(self, tile: tuple[int, int], items: list[dict]) -> None:
        if self.db is None:
            return
        from argus.db import utcnow
        from argus.models import AlprTile

        try:
            async with self.db.sessionmaker() as session:
                row = await session.get(AlprTile, self._key(tile))
                if row is None:
                    row = AlprTile(tile=self._key(tile))
                    session.add(row)
                row.cameras = items
                row.fetched_at = utcnow()
                await session.commit()
        except Exception as exc:  # noqa: BLE001 - the memory cache still works
            log.warning("ALPR tile store failed: {0}".format(exc))

    async def _load(self, covering: list[tuple[int, int]]) -> None:
        """Fill the memory cache from the stored tiles still fresh."""
        if self.db is None:
            return
        from sqlalchemy import select

        from argus.models import AlprTile

        missing = {self._key(t): t for t in covering if self.cached(t) is None}
        if not missing:
            return
        try:
            async with self.db.sessionmaker() as session:
                rows = (
                    await session.execute(
                        select(AlprTile).where(
                            AlprTile.tile.in_(list(missing))
                        )
                    )
                ).scalars()
                for row in rows:
                    age = time.time() - row.fetched_at.timestamp()
                    if age < TTL_S:
                        self.cache[missing[row.tile]] = (
                            row.fetched_at.timestamp(),
                            row.cameras,
                        )
        except Exception as exc:  # noqa: BLE001 - fall back to fetching
            log.warning("ALPR tile load failed: {0}".format(exc))

    def _start(self, tile: tuple[int, int]) -> None:
        """Fetch a tile in the background (one at a time, through the
        lock), unless it's already on its way."""
        if tile in self.pending:
            return
        task = asyncio.create_task(self._fill(tile))
        self.pending[tile] = task
        task.add_done_callback(lambda _: self.pending.pop(tile, None))

    async def _fill(self, tile: tuple[int, int]) -> None:
        try:
            await self.tile(tile)
        except (Busy, httpx.HTTPError, ValueError) as exc:
            code = getattr(getattr(exc, "response", None), "status_code", "")
            log.info(
                "ALPR tile {0}: {1} {2}".format(tile, type(exc).__name__, code)
            )

    async def area(self, bbox) -> tuple[list[dict], bool] | None:
        """Cameras in a bbox from the cached tiles, and whether every
        tile is in; None if the view is too big. Missing tiles are
        fetched in the background (Overpass can take most of a minute),
        so a call never waits on it; the map asks again."""
        covering = tiles(bbox)
        if covering is None:
            return None
        await self._load(covering)
        w, s, e, n = bbox
        out, complete = [], True
        for t in covering:
            items = self.cached(t)
            if items is None:
                complete = False
                if self.busy_until.get(t, 0) <= time.time():
                    self._start(t)
                continue
            out += [
                c for c in items if w <= c["lon"] <= e and s <= c["lat"] <= n
            ]
        return out, complete
