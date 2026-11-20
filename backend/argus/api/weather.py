"""Weather: NWS alerts, SPC outlooks and current conditions.

- /api/weather/alerts: active NWS alerts. Storm-based ones carry polygons
  for the map; with ?lat=&lon= (your home) it also lists every alert for
  that spot's NWS forecast zone and county, from api.weather.gov/points.
- /api/weather/outlook: today's and tomorrow's SPC risk areas.
- /api/weather/now: current conditions and today's range from Open-Meteo
  (free, no key), cached for 15 minutes per spot.
- /api/weather/forecast: "Weather here" for any spot: now, the next 24
  hours and 7 days, from Open-Meteo, cached for 15 minutes per spot.
- /api/weather/storms: tropical cyclones worldwide (argus/storms.py,
  GDACS), with track, forecast cone and wind swath.
"""

import time
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from argus.api.deps import DbDep, SessionDep
from argus.db import utcnow
from argus.models import NwsZone, RawRecord

router = APIRouter(tags=["weather"])

ALERTS_FRESH = timedelta(minutes=10)
OUTLOOK_FRESH = timedelta(hours=3)
POINTS = "https://api.weather.gov/points/{0:.4f},{1:.4f}"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
NOW_TTL_S = 900


def _ended(text: str | None, now: datetime) -> bool:
    if not text:
        return False
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")) < now
    except ValueError:
        return False


def _client(request: Request) -> httpx.AsyncClient:
    state = request.app.state
    if not hasattr(state, "weather_http"):
        state.weather_http = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": state.settings.user_agent},
            follow_redirects=True,
        )
        state.weather_cache = {}
    return state.weather_http


async def _home_zones(request: Request, lat: float, lon: float) -> set[str]:
    """The NWS forecast zone, county and fire zone for a spot (US only),
    cached for a day."""
    client = _client(request)
    cache = request.app.state.weather_cache
    key = "zones:{0:.2f},{1:.2f}".format(lat, lon)
    hit = cache.get(key)
    if hit and time.monotonic() - hit[0] < 86400:
        return hit[1]
    zones: set[str] = set()
    try:
        r = await client.get(
            POINTS.format(lat, lon), headers={"Accept": "application/geo+json"}
        )
        if r.status_code == 200:
            p = r.json().get("properties") or {}
            for k in ("forecastZone", "county", "fireWeatherZone"):
                if p.get(k):
                    zones.add(str(p[k]).rsplit("/", 1)[-1])
    except (httpx.HTTPError, ValueError):
        return set()
    cache[key] = (time.monotonic(), zones)
    return zones


@router.get("/api/weather/alerts")
async def alerts(
    session: SessionDep,
    db: DbDep,
    request: Request,
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    zones: bool = Query(False, description="add zone-based alerts' shapes"),
):
    now = utcnow()
    rows = (
        await db.execute(
            select(RawRecord).where(
                RawRecord.kind == "wxalert",
                RawRecord.fetched_at >= now - ALERTS_FRESH,
            )
        )
    ).scalars()
    home = await _home_zones(request, lat, lon) if lat is not None else set()
    rows = list(rows)
    shapes: dict[str, list] = {}
    if zones:
        ids = {z for r in rows for z in (r.payload or {}).get("zones") or []}
        if ids:
            shapes = {
                z.id: z.rings
                for z in (
                    await db.execute(
                        select(NwsZone).where(NwsZone.id.in_(list(ids)))
                    )
                ).scalars()
            }
    mapped, local, zoned = [], [], []
    for r in rows:
        p = r.payload
        if _ended(p.get("expires"), now):
            continue
        item = {
            "key": r.external_id,
            "event": p.get("event"),
            "headline": p.get("headline"),
            "severity": p.get("severity", 0),
            "urgency": p.get("urgency"),
            "area": p.get("area"),
            "sender": p.get("sender"),
            "onset": p.get("onset"),
            "expires": p.get("expires"),
            "description": p.get("description"),
            "instruction": p.get("instruction"),
            "polygons": p.get("polygons") or [],
            "url": p.get("url"),
            "lat": r.lat,
            "lon": r.lon,
        }
        if item["polygons"]:
            mapped.append(item)
        elif zones:
            rings = [
                ring
                for z in p.get("zones") or []
                for ring in shapes.get(z, [])
            ]
            if rings:
                zoned.append({**item, "polygons": rings, "zoned": True})
        if home and home & set(p.get("zones") or []):
            local.append(item)
    order = lambda i: (-(i["severity"] or 0), i["expires"] or "")  # noqa: E731
    mapped.sort(key=order)
    local.sort(key=order)
    zoned.sort(key=order)
    return {
        "alerts": mapped,
        "zoned": zoned,
        "local": local,
        "home_zones": sorted(home),
    }


@router.get("/api/weather/outlook")
async def outlook(session: SessionDep, db: DbDep):
    now = utcnow()
    rows = (
        await db.execute(
            select(RawRecord).where(
                RawRecord.kind == "outlook",
                RawRecord.fetched_at >= now - OUTLOOK_FRESH,
            )
        )
    ).scalars()
    items = []
    for r in rows:
        p = r.payload
        if _ended(p.get("valid_to"), now):
            continue
        items.append({"key": r.external_id, **p})
    items.sort(key=lambda i: (i.get("day", 1), i.get("level", 0)))
    return {"areas": items}


@router.get("/api/weather/now")
async def weather_now(
    session: SessionDep,
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Current conditions (metric; the browser converts for display)."""
    client = _client(request)
    cache = request.app.state.weather_cache
    key = "now:{0:.2f},{1:.2f}".format(lat, lon)
    hit = cache.get(key)
    if hit and time.monotonic() - hit[0] < NOW_TTL_S:
        return hit[1]
    try:
        r = await client.get(
            OPEN_METEO,
            params={
                "latitude": round(lat, 2),
                "longitude": round(lon, 2),
                "current": "temperature_2m,relative_humidity_2m,"
                "wind_speed_10m,wind_gusts_10m,wind_direction_10m,"
                "cloud_cover,precipitation,weather_code",
                "daily": "temperature_2m_max,temperature_2m_min,"
                "precipitation_probability_max",
                "forecast_days": 1,
                "timezone": "auto",
            },
        )
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return {"status": "error"}
    daily = body.get("daily") or {}

    def first(name: str):
        v = daily.get(name) or [None]
        return v[0]

    out = {
        "status": "ok",
        "current": body.get("current") or {},
        "high_c": first("temperature_2m_max"),
        "low_c": first("temperature_2m_min"),
        "rain_chance": first("precipitation_probability_max"),
        "source": "Open-Meteo",
    }
    cache[key] = (time.monotonic(), out)
    return out


FORECAST_HOURS = 24


@router.get("/api/weather/forecast")
async def forecast(
    session: SessionDep,
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """A spot's weather now, by the hour for a day and by the day for a
    week (metric; the browser converts for display)."""
    client = _client(request)
    cache = request.app.state.weather_cache
    key = "forecast:{0:.2f},{1:.2f}".format(lat, lon)
    hit = cache.get(key)
    if hit and time.monotonic() - hit[0] < NOW_TTL_S:
        return hit[1]
    try:
        r = await client.get(
            OPEN_METEO,
            params={
                "latitude": round(lat, 2),
                "longitude": round(lon, 2),
                "current": "temperature_2m,apparent_temperature,"
                "relative_humidity_2m,wind_speed_10m,wind_gusts_10m,"
                "wind_direction_10m,cloud_cover,precipitation,"
                "pressure_msl,visibility,weather_code,is_day",
                "hourly": "temperature_2m,precipitation_probability,"
                "precipitation,wind_speed_10m,wind_gusts_10m,weather_code",
                "daily": "weather_code,temperature_2m_max,"
                "temperature_2m_min,precipitation_probability_max,"
                "precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,"
                "sunrise,sunset",
                "forecast_days": 7,
                "timezone": "auto",
            },
        )
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return {"status": "error"}
    out = {
        "status": "ok",
        "current": body.get("current") or {},
        "hourly": _rows(body.get("hourly") or {}, FORECAST_HOURS, body),
        "daily": _rows(body.get("daily") or {}, 7),
        "timezone": body.get("timezone"),
        "utc_offset_s": body.get("utc_offset_seconds"),
        "elevation_m": body.get("elevation"),
        "source": "Open-Meteo",
    }
    cache[key] = (time.monotonic(), out)
    return out


def _rows(cols: dict, limit: int, body: dict | None = None) -> list[dict]:
    """Open-Meteo's columns as rows; hourly ones from the current hour."""
    times = cols.get("time") or []
    start = 0
    if body is not None:
        now = str((body.get("current") or {}).get("time") or "")[:13]
        for i, t in enumerate(times):
            if str(t)[:13] >= now:
                start = i
                break
    rows = []
    for i in range(start, min(len(times), start + limit)):
        rows.append(
            {
                k: (v[i] if isinstance(v, list) and i < len(v) else None)
                for k, v in cols.items()
            }
        )
    return rows


@router.get("/api/weather/storms")
async def storms(session: SessionDep, request: Request):
    since = (datetime.now(UTC) - timedelta(days=21)).strftime("%Y-%m-%d")
    return await request.app.state.storms.get(since)
