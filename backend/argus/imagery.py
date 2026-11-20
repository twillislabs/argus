"""Recent satellite imagery on request: Sentinel-2 (true colour, about
10 m, daylight and clear skies) and Sentinel-1 (radar, through cloud and
at night), from Microsoft's Planetary Computer (no key).

- passes(): the recent passes over a box, one per day, with cloud
  cover, from the STAC catalogue.
- mosaic(): registers that day's scenes over the box as one mosaic;
  its tiles come from the Planetary Computer's tiler.
- tile(): one map tile, fetched by this server and kept on disk for a
  week, so browsers never call Microsoft and each tile is fetched once.

Sentinel-1 uses the GRD collection: the terrain-corrected one needs a
Planetary Computer account. Copernicus Sentinel data is free to use
with attribution ("Contains modified Copernicus Sentinel data").
"""

import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

log = logging.getLogger("argus.imagery")

BASE = "https://planetarycomputer.microsoft.com/api"
STAC_SEARCH = "{0}/stac/v1/search".format(BASE)
REGISTER = "{0}/data/v1/mosaic/register".format(BASE)
TILE = (
    "{0}/data/v1/mosaic/{{sid}}/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}@1x.png"
).format(BASE)

KINDS = {
    "optical": {
        "collection": "sentinel-2-l2a",
        "params": [("assets", "visual"), ("nodata", "0")],
        "cloud": True,
    },
    "radar": {
        "collection": "sentinel-1-grd",
        "params": [("assets", "vv"), ("rescale", "0,350"), ("nodata", "0")],
        "cloud": False,
    },
}
LOOKBACK_DAYS = 60
MAX_SPAN_DEG = 1.0  # about 100 km
MIN_ZOOM, MAX_ZOOM = 6, 16
PASSES_TTL_S = 3600
TILE_TTL_S = 7 * 86400
TILE_MAX_BYTES = 3_000_000
CACHE_MAX_FILES = 20_000
SEARCH_ID = re.compile(r"^[A-Za-z0-9._-]{8,80}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ImageryError(Exception):
    """Something to tell the person asking."""


def check_box(box: tuple[float, float, float, float]) -> None:
    w, s, e, n = box
    if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
        raise ImageryError("Draw the box again: it isn't a valid area.")
    if e - w > MAX_SPAN_DEG or n - s > MAX_SPAN_DEG:
        raise ImageryError("Draw a smaller box: up to about 100 km across.")


def group_passes(features: list[dict], cloud: bool) -> list[dict]:
    """One entry per UTC day (a satellite pass), newest first."""
    days: dict[str, dict] = {}
    for f in features:
        p = f.get("properties") or {}
        when = p.get("datetime") or ""
        day = when[:10]
        if not DAY.match(day):
            continue
        d = days.setdefault(
            day,
            {"date": day, "time": when, "platforms": set(), "clouds": []},
        )
        if p.get("platform"):
            d["platforms"].add(str(p["platform"]))
        if cloud and isinstance(p.get("eo:cloud_cover"), (int, float)):
            d["clouds"].append(float(p["eo:cloud_cover"]))
        d["scenes"] = d.get("scenes", 0) + 1
    out = []
    for day in sorted(days, reverse=True):
        d = days[day]
        clouds = d.pop("clouds")
        d["platforms"] = sorted(d["platforms"])
        d["cloud"] = round(sum(clouds) / len(clouds), 1) if clouds else None
        out.append(d)
    return out


def _cql(collection: str, box, day: str) -> dict:
    w, s, e, n = box
    ring = [[w, s], [e, s], [e, n], [w, n], [w, s]]
    return {
        "collections": [collection],
        "filter-lang": "cql2-json",
        "filter": {
            "op": "and",
            "args": [
                {
                    "op": "s_intersects",
                    "args": [
                        {"property": "geometry"},
                        {"type": "Polygon", "coordinates": [ring]},
                    ],
                },
                {
                    "op": "anyinteracts",
                    "args": [
                        {"property": "datetime"},
                        {
                            "interval": [
                                "{0}T00:00:00Z".format(day),
                                "{0}T23:59:59Z".format(day),
                            ]
                        },
                    ],
                },
            ],
        },
    }


class Imagery:
    """Shared, cached lookups and tiles for everyone."""

    def __init__(self, user_agent: str, cache_dir: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=5.0),
            headers={"User-Agent": user_agent},
        )
        self.cache_dir = Path(
            cache_dir or Path(tempfile.gettempdir()) / "argus-imagery"
        )
        self.passes_cache: dict[str, tuple[float, list[dict]]] = {}
        self.mosaics: dict[str, str] = {}
        # One fetch per tile at a time, however many viewers ask.
        self.inflight: dict[str, asyncio.Future] = {}
        self.writes = 0

    async def close(self) -> None:
        await self.client.aclose()

    async def passes(self, kind: str, box) -> list[dict]:
        check_box(box)
        spec = KINDS[kind]
        key = "{0}:{1:.2f},{2:.2f},{3:.2f},{4:.2f}".format(kind, *box)
        hit = self.passes_cache.get(key)
        if hit and time.monotonic() - hit[0] < PASSES_TTL_S:
            return hit[1]
        since = datetime.now(UTC) - timedelta(days=LOOKBACK_DAYS)
        props = ["id", "properties.datetime", "properties.platform"]
        if spec["cloud"]:
            props.append("properties.eo:cloud_cover")
        r = await self.client.post(
            STAC_SEARCH,
            json={
                "collections": [spec["collection"]],
                "bbox": list(box),
                "datetime": "{0}/..".format(
                    since.strftime("%Y-%m-%dT%H:%M:%SZ")
                ),
                "limit": 200,
                "sortby": [
                    {"field": "properties.datetime", "direction": "desc"}
                ],
                "fields": {"include": props, "exclude": ["assets", "links"]},
            },
        )
        r.raise_for_status()
        found = group_passes(r.json().get("features") or [], spec["cloud"])
        self.passes_cache[key] = (time.monotonic(), found)
        if len(self.passes_cache) > 300:
            oldest = min(
                self.passes_cache, key=lambda k: self.passes_cache[k][0]
            )
            self.passes_cache.pop(oldest, None)
        return found

    async def mosaic(self, kind: str, box, day: str) -> str:
        check_box(box)
        if not DAY.match(day):
            raise ImageryError("Pick a pass from the list.")
        key = "{0}:{1}:{2:.3f},{3:.3f},{4:.3f},{5:.3f}".format(kind, day, *box)
        if key in self.mosaics:
            return self.mosaics[key]
        r = await self.client.post(
            REGISTER, json=_cql(KINDS[kind]["collection"], box, day)
        )
        r.raise_for_status()
        sid = r.json().get("searchid") or ""
        if not SEARCH_ID.match(sid):
            raise ImageryError("The imagery service gave an odd answer.")
        self.mosaics[key] = sid
        return sid

    def _path(self, kind: str, sid: str, z: int, x: int, y: int) -> Path:
        name = hashlib.sha256(
            "{0}/{1}/{2}/{3}/{4}".format(kind, sid, z, x, y).encode()
        ).hexdigest()
        return self.cache_dir / name[:2] / "{0}.png".format(name)

    async def tile(self, kind: str, sid: str, z: int, x: int, y: int):
        """PNG bytes, or None where the mosaic has no data."""
        if not SEARCH_ID.match(sid) or not MIN_ZOOM <= z <= MAX_ZOOM:
            raise ImageryError("No such tile.")
        if not (0 <= x < 2**z and 0 <= y < 2**z):
            raise ImageryError("No such tile.")
        path = self._path(kind, sid, z, x, y)
        try:
            if time.time() - path.stat().st_mtime < TILE_TTL_S:
                data = path.read_bytes()
                return data or None
        except OSError:
            pass
        key = str(path)
        if key in self.inflight:
            return await asyncio.shield(self.inflight[key])
        fut = asyncio.get_running_loop().create_future()
        self.inflight[key] = fut
        try:
            data = await self._fetch(kind, sid, z, x, y)
            self._store(path, data or b"")
            fut.set_result(data)
            return data
        except Exception as exc:
            fut.set_exception(exc)
            fut.exception()  # mark retrieved for shielded waiters
            raise
        finally:
            self.inflight.pop(key, None)

    async def _fetch(self, kind, sid, z, x, y) -> bytes | None:
        spec = KINDS[kind]
        r = await self.client.get(
            TILE.format(sid=sid, z=z, x=x, y=y),
            params=[("collection", spec["collection"]), *spec["params"]],
        )
        if r.status_code in (204, 404):
            return None
        if r.status_code >= 400:
            log.warning(
                "Imagery tile {0}/{1}/{2}: {3} {4}".format(
                    z, x, y, r.status_code, r.text[:200]
                )
            )
        r.raise_for_status()
        if not r.headers.get("content-type", "").startswith("image/"):
            raise ImageryError("The imagery service sent something else.")
        if len(r.content) > TILE_MAX_BYTES:
            raise ImageryError("That tile is too large.")
        return r.content

    def _store(self, path: Path, data: bytes) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, path)
        except OSError as exc:
            log.warning("Imagery cache write failed: {0}".format(exc))
            return
        self.writes += 1
        if self.writes % 500 == 0:
            self._prune()

    def _prune(self) -> None:
        """Drop expired tiles, then the oldest past CACHE_MAX_FILES."""
        try:
            files = [
                (p.stat().st_mtime, p) for p in self.cache_dir.rglob("*.png")
            ]
        except OSError:
            return
        now = time.time()
        files.sort()
        extra = len(files) - CACHE_MAX_FILES
        for i, (mtime, p) in enumerate(files):
            if now - mtime > TILE_TTL_S or i < extra:
                p.unlink(missing_ok=True)
