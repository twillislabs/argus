"""Airspace structure from openAIP (an admin's free API key): restricted,
prohibited and danger areas, control zones, terminal areas and so on.

Fetched by area for the map view in 2-degree tiles, cached for a day, so
looking around doesn't call openAIP more than needed. openAIP data is
CC BY-NC 4.0 (non-commercial), so it's never stored beyond the cache.
https://www.openaip.net/
"""

import logging
import math
import time

import httpx

log = logging.getLogger("argus.openaip")

API = "https://api.core.openaip.net/api/airspaces"
TILE_DEG = 2
TTL_S = 24 * 3600
MAX_TILES = 36
MAX_PAGES = 5

TYPES = {
    0: "Other",
    1: "Restricted",
    2: "Danger",
    3: "Prohibited",
    4: "Control zone (CTR)",
    5: "Transponder zone (TMZ)",
    6: "Radio zone (RMZ)",
    7: "Terminal area (TMA)",
    8: "Temporary reserved (TRA)",
    9: "Temporary segregated (TSA)",
    10: "Flight information region (FIR)",
    11: "Upper FIR (UIR)",
    12: "Air defence identification zone (ADIZ)",
    13: "Aerodrome traffic zone (ATZ)",
    14: "Military ATZ (MATZ)",
    15: "Airway",
    16: "Military training route (MTR)",
    17: "Alert area",
    18: "Warning area",
    19: "Protected area",
    20: "Helicopter traffic zone",
    21: "Gliding sector",
    22: "Transponder setting (TRP)",
    23: "Traffic information zone (TIZ)",
    24: "Traffic information area (TIA)",
    25: "Military training area (MTA)",
    26: "Control area (CTA)",
    27: "ACC sector",
    28: "Aerial sporting",
    29: "Low overflight restriction",
}
CLASSES = {
    0: "A",
    1: "B",
    2: "C",
    3: "D",
    4: "E",
    5: "F",
    6: "G",
    8: "Unclassified",
}
# Types not worth drawing on a situation map (too big or too routine).
SKIP_TYPES = {10, 11, 15, 22, 27}
UNITS = {0: "m", 1: "ft", 6: "FL"}
DATUMS = {0: "GND", 1: "MSL", 2: "STD"}


def limit_text(limit: dict | None) -> str | None:
    if not limit:
        return None
    value = limit.get("value")
    unit = UNITS.get(limit.get("unit"), "")
    datum = DATUMS.get(limit.get("referenceDatum"), "")
    if value in (None, ""):
        return None
    if unit == "FL":
        return "FL{0:03d}".format(int(value))
    if value == 0 and datum == "GND":
        return "Surface"
    return "{0:,} {1} {2}".format(int(value), unit, datum).strip()


def normalise(item: dict) -> dict | None:
    t = item.get("type")
    if t in SKIP_TYPES:
        return None
    geometry = item.get("geometry") or {}
    if geometry.get("type") != "Polygon":
        return None
    ring = [
        [round(float(x), 4), round(float(y), 4)]
        for x, y, *_ in geometry["coordinates"][0]
    ]
    if len(ring) < 4:
        return None
    xs = [p[0] for p in ring[:-1]]
    ys = [p[1] for p in ring[:-1]]
    return {
        "key": "openaip:{0}".format(item.get("_id")),
        "kind": "structure",
        "id": item.get("name") or TYPES.get(t, "Airspace"),
        "title": item.get("name") or TYPES.get(t, "Airspace"),
        "hazard": TYPES.get(t, "Other"),
        "type_code": t,
        "area": "Class {0}".format(CLASSES[item["icaoClass"]])
        if item.get("icaoClass") in CLASSES
        else None,
        "countries": [item["country"]] if item.get("country") else None,
        "lower": limit_text(item.get("lowerLimit")),
        "upper": limit_text(item.get("upperLimit")),
        "polygon": ring,
        "lat": sum(ys) / len(ys),
        "lon": sum(xs) / len(xs),
        "url": "https://www.openaip.net/",
    }


def tiles(bbox) -> list[tuple[int, int]] | None:
    """2-degree tiles covering a bbox, or None if there are too many."""
    w, s, e, n = bbox
    if w > e:
        return None
    xs = range(math.floor(w / TILE_DEG), math.floor(e / TILE_DEG) + 1)
    ys = range(math.floor(s / TILE_DEG), math.floor(n / TILE_DEG) + 1)
    out = [(x, y) for x in xs for y in ys]
    return out if len(out) <= MAX_TILES else None


class Blocked(Exception):
    """openAIP's Cloudflare front end refused this server (a 403 page, not
    an API answer), whatever the key."""


class OpenAip:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: dict[tuple[int, int], tuple[float, list[dict]]] = {}

    async def close(self) -> None:
        await self.client.aclose()

    async def tile(self, key: str, tile: tuple[int, int]) -> list[dict]:
        hit = self.cache.get(tile)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
        x, y = tile
        bbox = "{0},{1},{2},{3}".format(
            x * TILE_DEG, y * TILE_DEG, (x + 1) * TILE_DEG, (y + 1) * TILE_DEG
        )
        items: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            response = await self.client.get(
                API,
                params={"bbox": bbox, "limit": 1000, "page": page},
                headers={"x-openaip-api-key": key},
            )
            if response.status_code == 403 and "cdn-cgi" in response.text:
                raise Blocked()
            response.raise_for_status()
            body = response.json()
            for raw in body.get("items", []):
                item = normalise(raw)
                if item is not None:
                    items.append(item)
            if page >= int(body.get("totalPages") or 1):
                break
        self.cache[tile] = (time.time(), items)
        if len(self.cache) > 2000:
            oldest = min(self.cache, key=lambda k: self.cache[k][0])
            self.cache.pop(oldest, None)
        return items

    async def area(self, key: str, bbox) -> list[dict] | None:
        covering = tiles(bbox)
        if covering is None:
            return None
        seen: dict[str, dict] = {}
        for t in covering:
            for item in await self.tile(key, t):
                seen[item["key"]] = item
        return list(seen.values())
