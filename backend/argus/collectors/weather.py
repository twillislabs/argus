"""US weather warnings and severe-weather outlooks.

- NWS alerts (api.weather.gov, public domain): every active warning, watch
  and advisory. Storm-based warnings (tornado, severe thunderstorm, flash
  flood) carry their own polygon and are drawn on the map; zone-based ones
  list the NWS zones they cover, so the API can show those for your home.
- SPC convective outlooks (spc.noaa.gov, public domain): today's and
  tomorrow's categorical risk areas, on the 1-5 scale (Marginal to High)
  the Storm Prediction Center uses.

Each becomes a raw record (kind "wxalert" or "outlook"), not an event; the
API serves the ones still in force.
"""

from datetime import UTC, datetime

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

NWS_ALERTS = "https://api.weather.gov/alerts/active?status=actual"
SPC_OUTLOOK = (
    "https://www.spc.noaa.gov/products/outlook/day{0}otlk_cat.lyr.geojson"
)

# How bad an alert is for the map's colours and sorting (0-4).
SEVERITY = {"Extreme": 4, "Severe": 3, "Moderate": 2, "Minor": 1}
# SPC categorical risk: the label, its level and the plain name.
SPC_LEVELS = {
    "TSTM": (0, "Thunderstorms"),
    "MRGL": (1, "Marginal"),
    "SLGT": (2, "Slight"),
    "ENH": (3, "Enhanced"),
    "MDT": (4, "Moderate"),
    "HIGH": (5, "High"),
}


def _rings(geometry: dict | None) -> list[list[list[float]]]:
    if not geometry:
        return []
    if geometry.get("type") == "Polygon":
        polys = [geometry["coordinates"]]
    elif geometry.get("type") == "MultiPolygon":
        polys = geometry["coordinates"]
    else:
        return []
    out = []
    for poly in polys:
        ring = [
            [round(float(x), 4), round(float(y), 4)] for x, y, *_ in poly[0]
        ]
        if len(ring) >= 4:
            out.append(ring)
    return out


def _centre(ring: list[list[float]]) -> tuple[float, float]:
    xs = [p[0] for p in ring[:-1]]
    ys = [p[1] for p in ring[:-1]]
    return sum(ys) / len(ys), sum(xs) / len(xs)


def parse_alerts(doc: dict, now: datetime) -> list[RawIn]:
    out = []
    for f in doc.get("features", []):
        p = f.get("properties") or {}
        alert_id = str(p.get("id") or f.get("id") or "")
        if not alert_id:
            continue
        rings = _rings(f.get("geometry"))
        lat, lon = _centre(rings[0]) if rings else (None, None)
        zones = [
            str(z).rsplit("/", 1)[-1] for z in p.get("affectedZones") or []
        ]
        out.append(
            RawIn(
                source="nws",
                external_id=alert_id[-150:],
                kind="wxalert",
                observed_at=now,
                lat=lat,
                lon=lon,
                payload={
                    "event": p.get("event") or "Alert",
                    "headline": p.get("headline") or p.get("event") or "",
                    "severity": SEVERITY.get(p.get("severity"), 0),
                    "urgency": p.get("urgency"),
                    "certainty": p.get("certainty"),
                    "area": (p.get("areaDesc") or "")[:400],
                    "sender": p.get("senderName"),
                    "onset": p.get("onset") or p.get("effective"),
                    "expires": p.get("ends") or p.get("expires"),
                    "description": (p.get("description") or "")[:1500],
                    "instruction": (p.get("instruction") or "")[:800],
                    "polygons": rings,
                    "zones": zones[:60],
                    "url": "https://alerts.weather.gov/search?id={0}".format(
                        alert_id.rsplit("/", 1)[-1]
                    ),
                },
            )
        )
    return out


def _spc_time(text: str | None) -> str | None:
    """SPC's 202611191300 as ISO 8601 UTC."""
    if not text or len(text) < 12:
        return None
    try:
        return (
            datetime.strptime(text[:12], "%Y%m%d%H%M")
            .replace(tzinfo=UTC)
            .isoformat()
        )
    except ValueError:
        return None


def parse_outlook(doc: dict, day: int, now: datetime) -> list[RawIn]:
    out = []
    for f in doc.get("features", []):
        p = f.get("properties") or {}
        label = str(p.get("LABEL") or "")
        if label not in SPC_LEVELS:
            continue
        level, name = SPC_LEVELS[label]
        rings = _rings(f.get("geometry"))
        if not rings:
            continue
        lat, lon = _centre(rings[0])
        out.append(
            RawIn(
                source="spc",
                external_id="day{0}:{1}".format(day, label),
                kind="outlook",
                observed_at=now,
                lat=lat,
                lon=lon,
                payload={
                    "day": day,
                    "label": label,
                    "level": level,
                    "name": name,
                    "title": (
                        "Level {0} ({1}) severe storm risk".format(level, name)
                        if level
                        else "General thunderstorms"
                    ),
                    "fill": p.get("fill"),
                    "valid_from": _spc_time(p.get("VALID")),
                    "valid_to": _spc_time(p.get("EXPIRE")),
                    "polygons": rings,
                    "url": "https://www.spc.noaa.gov/products/outlook/"
                    "day{0}otlk.html".format(day),
                },
            )
        )
    return out


class NwsCollector(Collector):
    name = "nws"
    label = "NWS warnings and alerts"
    interval_s = 120
    licence = "Public domain (NOAA / NWS)"
    terms_url = "https://www.weather.gov/documentation/services-web-api"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(
            NWS_ALERTS, headers={"Accept": "application/geo+json"}
        )
        if response.status_code != 200:
            raise SourceError("NWS returned {0}".format(response.status_code))
        return CollectResult(
            records=parse_alerts(response.json(), datetime.now(UTC))
        )


class SpcCollector(Collector):
    name = "spc"
    label = "SPC severe weather outlooks"
    interval_s = 1800
    licence = "Public domain (NOAA / SPC)"
    terms_url = "https://www.spc.noaa.gov/"

    async def collect(self, client: httpx.AsyncClient, cursor):
        now = datetime.now(UTC)
        records, failures = [], []
        for day in (1, 2):
            response = await client.get(SPC_OUTLOOK.format(day))
            if response.status_code != 200:
                failures.append("day{0}".format(day))
                continue
            records += parse_outlook(response.json(), day, now)
        if len(failures) == 2:
            raise SourceError("SPC returned errors")
        return CollectResult(records=records, failures=failures)
