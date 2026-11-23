"""Wildfire outlines: the mapped perimeters of current US wildfires from
NIFC (WFIGS Interagency Perimeters, Current; public domain, no key),
the same incidents the nifc collector puts on the map as points.

Fetched on demand, at most every TTL_S, simplified on NIFC's side
(maxAllowableOffset) and again here, and kept in API memory.
https://data-nifc.opendata.arcgis.com/
"""

import asyncio
import logging
import time

import httpx

from argus.geo import simplify

log = logging.getLogger("argus.fireperims")

URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
    "WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query"
)
FIELDS = (
    "poly_IncidentName,attr_IncidentName,poly_GISAcres,"
    "attr_PercentContained,attr_UniqueFireIdentifier,attr_POOState,"
    "attr_FireDiscoveryDateTime,poly_DateCurrent"
)
MIN_ACRES = 100
TTL_S = 1800
RETRY_S = 300
# About 50 m, then the same again here: outlines stay true at county
# zoom without thousands of points per fire.
OFFSET_DEG = 0.0005
MAX_POINTS = 4000


def _rings(geometry: dict) -> list[list[list[float]]]:
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        polys = [coords]
    elif kind == "MultiPolygon":
        polys = coords
    else:
        return []
    out = []
    for poly in polys:
        for ring in poly:
            pts = [
                [round(float(p[0]), 5), round(float(p[1]), 5)]
                for p in ring
                if len(p) >= 2
            ]
            pts = simplify(pts, OFFSET_DEG)
            if len(pts) >= 4:
                out.append(pts)
    return out


def _ms_iso(ms) -> str | None:
    if not isinstance(ms, (int, float)):
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def parse_perimeters(doc: dict) -> list[dict]:
    out = []
    for f in doc.get("features") or []:
        p = f.get("properties") or {}
        uid = p.get("attr_UniqueFireIdentifier")
        rings = _rings(f.get("geometry") or {})
        if not uid or not rings:
            continue
        if sum(len(r) for r in rings) > MAX_POINTS:
            # Very large fires: simplify harder rather than drop them.
            rings = [
                r2
                for r2 in (simplify(r, OFFSET_DEG * 4) for r in rings)
                if len(r2) >= 4
            ]
        xs = [pt[0] for r in rings for pt in r]
        ys = [pt[1] for r in rings for pt in r]
        name = (
            (p.get("poly_IncidentName") or p.get("attr_IncidentName") or "")
            .strip()
            .title()
        ) or "Unnamed"
        contained = p.get("attr_PercentContained")
        out.append(
            {
                "id": str(uid),
                "event_key": "nifc:{0}".format(uid),
                "name": "{0} Fire".format(name)
                if not name.lower().endswith(("fire", "complex"))
                else name,
                "acres": round(float(p.get("poly_GISAcres") or 0)),
                "contained": round(float(contained))
                if isinstance(contained, (int, float))
                else None,
                "state": (p.get("attr_POOState") or "").replace("US-", "")
                or None,
                "discovered": _ms_iso(p.get("attr_FireDiscoveryDateTime")),
                "mapped": _ms_iso(p.get("poly_DateCurrent")),
                "lat": round((min(ys) + max(ys)) / 2, 4),
                "lon": round((min(xs) + max(xs)) / 2, 4),
                "rings": rings,
            }
        )
    out.sort(key=lambda x: -x["acres"])
    return out


class FirePerimeters:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(40.0, connect=8.0),
            headers={"User-Agent": user_agent},
        )
        self.cache: tuple[float, list[dict]] | None = None
        self.failed_at: float | None = None
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def current(self) -> dict:
        async with self.lock:
            now = time.monotonic()
            if self.cache and now - self.cache[0] < TTL_S:
                return {"status": "ok", "fires": self.cache[1]}
            if self.failed_at is not None and now - self.failed_at < RETRY_S:
                return self._stale()
            try:
                r = await self.client.get(
                    URL,
                    params={
                        "where": (
                            "attr_IncidentTypeCategory='WF' AND "
                            "poly_GISAcres>={0}"
                        ).format(MIN_ACRES),
                        "outFields": FIELDS,
                        "maxAllowableOffset": str(OFFSET_DEG),
                        "geometryPrecision": "5",
                        "outSR": "4326",
                        "f": "geojson",
                    },
                )
                r.raise_for_status()
                fires = parse_perimeters(r.json())
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("NIFC perimeters failed: {0}".format(exc))
                self.failed_at = now
                return self._stale()
            self.cache = (now, fires)
            self.failed_at = None
            return {"status": "ok", "fires": fires}

    def _stale(self) -> dict:
        if self.cache:
            return {"status": "ok", "fires": self.cache[1]}
        return {"status": "error", "fires": []}
