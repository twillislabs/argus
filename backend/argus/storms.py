"""Tropical cyclones worldwide: track, forecast cone and wind swath.

From GDACS (UN OCHA / EU JRC, free with credit), which carries every
basin (NHC, JTWC, JMA and the rest) in one shape: the current storms'
list, then each storm's geometry (observed and forecast track segments
labelled with the storm's category, the forecast uncertainty cone and
the cumulative wind swath at 60, 90 and 120 km/h). The storms
themselves are already events (collectors/hazards.py, kind "hazard");
this is the map's drawing of them, fetched on demand and cached.
"""

import asyncio
import time
from typing import Any

import httpx

LIST_URL = (
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    "?eventlist=TC&alertlevel=green;orange;red&fromdate={0}"
)
GEOMETRY_URL = (
    "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry"
    "?eventtype=TC&eventid={0}&episodeid={1}"
)
REPORT_URL = (
    "https://www.gdacs.org/report.aspx?eventtype=TC&eventid={0}&episodeid={1}"
)
TTL_S = 1800
MAX_STORMS = 12
LEVEL = {"green": 1, "orange": 3, "red": 4}
# GDACS track labels: the Saffir-Simpson-style category of each segment.
CATEGORY = {
    "TD": "Tropical depression",
    "TS": "Tropical storm",
    "HU": "Hurricane / typhoon",
    "H1": "Category 1",
    "H2": "Category 2",
    "H3": "Category 3",
    "H4": "Category 4",
    "H5": "Category 5",
}
SWATH_LABELS = ("60 km/h", "90 km/h", "120 km/h")


def _ring(coords: Any) -> list[list[float]] | None:
    try:
        ring = [
            [round(float(x), 3), round(float(y), 3)] for x, y, *_ in coords
        ]
    except (TypeError, ValueError):
        return None
    if len(ring) < 4:
        return None
    return ring


def _rings(geometry: dict) -> list[list[list[float]]]:
    kind = geometry.get("type")
    if kind == "Polygon":
        polys = [geometry.get("coordinates") or []]
    elif kind == "MultiPolygon":
        polys = geometry.get("coordinates") or []
    else:
        return []
    out = []
    for poly in polys:
        if poly:
            ring = _ring(poly[0])
            if ring:
                out.append(ring)
    return out


def _far(a: list[float], b: list[float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def parse_geometry(doc: dict, event: dict) -> dict | None:
    """One storm for the map from GDACS's geometry for it."""
    track: list[dict] = []
    cone: list[list[list[float]]] = []
    swath: list[dict] = []
    centre = None
    for f in doc.get("features") or []:
        g = f.get("geometry") or {}
        p = f.get("properties") or {}
        cls = str(p.get("Class") or "")
        label = str(p.get("polygonlabel") or "")
        if cls == "Point_Centroid" and g.get("type") == "Point":
            try:
                x, y = g["coordinates"][:2]
                centre = [round(float(x), 3), round(float(y), 3)]
            except (KeyError, TypeError, ValueError):
                pass
        elif cls.startswith("Line_") and g.get("type") == "LineString":
            try:
                coords = [
                    [round(float(x), 3), round(float(y), 3)]
                    for x, y, *_ in g.get("coordinates") or []
                ]
            except (TypeError, ValueError):
                continue
            if len(coords) >= 2:
                track.append(
                    {
                        "coords": coords,
                        "forecast": p.get("forecast") is True,
                        "category": label,
                    }
                )
        elif cls == "Poly_Cones":
            cone.extend(_rings(g))
        elif (
            cls.startswith("Poly_")
            and label in SWATH_LABELS
            and not p.get("featuretype")
        ):
            rings = _rings(g)
            if rings:
                swath.append({"label": label, "rings": rings})
    if centre is None and not track:
        return None
    if centre is None:
        observed = [t for t in track if not t["forecast"]] or track
        centre = observed[-1]["coords"][-1]
    # The category now: the segment leaving the storm's position (GDACS
    # lists segments in no particular order), else the one reaching it.
    now_cat = ""
    if track:
        ahead = [t for t in track if t["forecast"]]
        if ahead:
            seg = min(ahead, key=lambda t: _far(t["coords"][0], centre))
        else:
            seg = min(track, key=lambda t: _far(t["coords"][-1], centre))
        now_cat = seg["category"]
    level = str(event.get("alertlevel") or "").lower()
    return {
        "id": "{0}".format(event.get("eventid")),
        "name": str(event.get("eventname") or event.get("name") or "")[:80],
        "title": str(event.get("name") or "")[:120],
        "level": LEVEL.get(level, 1),
        "alert": level or "green",
        "category": now_cat,
        "category_label": CATEGORY.get(now_cat, now_cat),
        "position": centre,
        "track": track,
        "cone": cone,
        "swath": swath,
        "country": str(event.get("country") or "")[:120],
        "updated": event.get("datemodified") or event.get("todate"),
        "report": REPORT_URL.format(
            event.get("eventid"), event.get("episodeid")
        ),
    }


def current_events(doc: dict) -> list[dict]:
    out = []
    for f in doc.get("features") or []:
        p = f.get("properties") or {}
        if str(p.get("iscurrent")).lower() != "true":
            continue
        if p.get("eventid") is None or p.get("episodeid") is None:
            continue
        out.append(p)
    out.sort(key=lambda p: -(LEVEL.get(str(p.get("alertlevel")).lower(), 1)))
    return out[:MAX_STORMS]


class Storms:
    """GDACS cyclones, fetched on demand and cached for half an hour."""

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=8.0),
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )
        self.cache: tuple[float, dict] | None = None
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def get(self, since: str) -> dict:
        async with self.lock:
            if self.cache and time.monotonic() - self.cache[0] < TTL_S:
                return self.cache[1]
            out = await self._fetch(since)
            # Keep the last good answer when GDACS is down.
            if out["status"] == "ok" or not self.cache:
                self.cache = (time.monotonic(), out)
                return out
            return self.cache[1]

    async def _fetch(self, since: str) -> dict:
        try:
            r = await self.client.get(LIST_URL.format(since))
            r.raise_for_status()
            events = current_events(r.json())
        except (httpx.HTTPError, ValueError):
            return {"status": "error", "storms": []}
        storms = []
        for e in events:
            try:
                g = await self.client.get(
                    GEOMETRY_URL.format(e["eventid"], e["episodeid"])
                )
                g.raise_for_status()
                storm = parse_geometry(g.json(), e)
            except (httpx.HTTPError, ValueError):
                continue
            if storm:
                storms.append(storm)
        return {"status": "ok", "storms": storms, "source": "GDACS"}
