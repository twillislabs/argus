"""Global Fishing Watch events (an admin's free API token): ships
meeting at sea (encounters, often transshipment), loitering, and AIS
gaps (a ship's transponder going quiet, sometimes on purpose).

Fetched for the map view in TILE_DEG tiles, the last DAYS days, and
cached TTL_S in API memory. GFW data is CC BY-NC 4.0 (non-commercial)
and its token must stay off public pages, so the API fetches and the
data is never stored. Events run a few days behind real time.
https://globalfishingwatch.org/our-apis/
"""

import asyncio
import logging
import math
import time
from datetime import UTC, datetime, timedelta

import httpx

log = logging.getLogger("argus.fishing")

EVENTS = "https://gateway.api.globalfishingwatch.org/v3/events"
DATASETS = {
    "encounter": "public-global-encounters-events:latest",
    "loitering": "public-global-loitering-events:latest",
    "gap": "public-global-gaps-events:latest",
}
TILE_DEG = 5
MAX_TILES = 16
DAYS = 30
TTL_S = 6 * 3600
PAGE = 500
MAX_PAGES = 4
ATTRIBUTION = "Powered by Global Fishing Watch (CC BY-NC 4.0)"


class Forbidden(Exception):
    """The token was refused (401), or lacks a dataset (403)."""


def tiles(bbox) -> list[tuple[int, int]] | None:
    """TILE_DEG tiles covering a bbox, or None if there are too many."""
    w, s, e, n = bbox
    if w > e:
        return None
    xs = range(math.floor(w / TILE_DEG), math.floor(e / TILE_DEG) + 1)
    ys = range(math.floor(s / TILE_DEG), math.floor(n / TILE_DEG) + 1)
    out = [(x, y) for x in xs for y in ys]
    return out if len(out) <= MAX_TILES else None


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def _vessel(v: dict | None) -> dict | None:
    if not isinstance(v, dict):
        return None
    return {
        "id": v.get("id"),
        "name": (v.get("name") or "").strip() or None,
        "mmsi": v.get("ssvid") or None,
        "flag": v.get("flag") or None,
        "type": (v.get("type") or "").replace("_", " ") or None,
    }


def parse_event(e: dict) -> dict | None:
    kind = str(e.get("type") or "").lower()
    if kind not in DATASETS:
        return None
    pos = e.get("position") or {}
    lat, lon = _num(pos.get("lat")), _num(pos.get("lon"))
    if lat is None or lon is None or not e.get("id"):
        return None
    out = {
        "id": str(e["id"]),
        "kind": kind,
        "start": e.get("start"),
        "end": e.get("end"),
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "vessel": _vessel(e.get("vessel")),
        "eez": None,
    }
    regions = e.get("regions") or {}
    if regions.get("highSeas"):
        out["eez"] = "High seas"
    distances = e.get("distances") or {}
    out["shore_km"] = _num(distances.get("startDistanceFromShoreKm"))
    if kind == "encounter":
        enc = e.get("encounter") or {}
        out["other"] = _vessel(enc.get("vessel"))
        out["distance_km"] = _num(enc.get("medianDistanceKilometers"))
        out["speed_kn"] = _num(enc.get("medianSpeedKnots"))
    elif kind == "loitering":
        loi = e.get("loitering") or {}
        out["hours"] = _num(loi.get("totalTimeHours"))
        out["speed_kn"] = _num(loi.get("averageSpeedKnots"))
    else:
        gap = e.get("gap") or {}
        out["hours"] = _num(gap.get("durationHours"))
        out["distance_km"] = _num(gap.get("distanceKm"))
        out["intentional"] = gap.get("intentionalDisabling")
    if out.get("hours") is None and out["start"] and out["end"]:
        try:
            a = datetime.fromisoformat(
                str(out["start"]).replace("Z", "+00:00")
            )
            b = datetime.fromisoformat(str(out["end"]).replace("Z", "+00:00"))
            out["hours"] = round((b - a).total_seconds() / 3600, 1)
        except ValueError:
            pass
    return out


class Fishing:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(40.0, connect=8.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: dict[tuple[int, int], tuple[float, list[dict]]] = {}
        # Datasets this token may not read (gaps is a prototype).
        self.refused: set[str] = set()
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def _page(self, key: str, body: dict, offset: int) -> dict:
        r = await self.client.post(
            EVENTS,
            params={"offset": offset, "limit": PAGE},
            json=body,
            headers={"Authorization": "Bearer {0}".format(key)},
        )
        if r.status_code in (401, 403):
            raise Forbidden(r.text[:300])
        r.raise_for_status()
        return r.json()

    async def tile(self, key: str, tile: tuple[int, int]) -> list[dict]:
        hit = self.cache.get(tile)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
        x, y = tile
        w, s = x * TILE_DEG, y * TILE_DEG
        e, n = w + TILE_DEG, min(s + TILE_DEG, 90)
        today = datetime.now(UTC).date()
        body = {
            "startDate": (today - timedelta(days=DAYS)).isoformat(),
            "endDate": (today + timedelta(days=1)).isoformat(),
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
            },
        }
        items: dict[str, dict] = {}
        for kind, dataset in DATASETS.items():
            if dataset in self.refused:
                continue
            try:
                for page in range(MAX_PAGES):
                    doc = await self._page(
                        key, body | {"datasets": [dataset]}, page * PAGE
                    )
                    for raw in doc.get("entries") or []:
                        ev = parse_event(raw)
                        if ev:
                            items[ev["id"]] = ev
                    nxt = doc.get("nextOffset")
                    if not nxt or nxt >= int(doc.get("total") or 0):
                        break
            except Forbidden:
                if kind == "encounter":
                    raise
                # Loitering or gaps not open to this token: skip them.
                log.info("GFW refused {0}; skipping it".format(dataset))
                self.refused.add(dataset)
        found = list(items.values())
        self.cache[tile] = (time.time(), found)
        if len(self.cache) > 500:
            oldest = min(self.cache, key=lambda k: self.cache[k][0])
            self.cache.pop(oldest, None)
        return found

    async def area(self, key: str, bbox) -> list[dict] | None:
        covering = tiles(bbox)
        if covering is None:
            return None
        w, s, e, n = bbox
        seen: dict[str, dict] = {}
        async with self.lock:
            for t in covering:
                for ev in await self.tile(key, t):
                    if w <= ev["lon"] <= e and s <= ev["lat"] <= n:
                        seen[ev["id"]] = ev
        return sorted(
            seen.values(),
            key=lambda ev: str(ev.get("start") or ""),
            reverse=True,
        )
