"""Air quality for the map: a grid of points over the view, each with
the current US AQI (and the European index, PM2.5, PM10, ozone and
NO2), from Open-Meteo's air quality API (no key; CAMS data, CC BY 4.0).

The grid's step grows with the view (GRID_STEPS) so a view never needs
more than MAX_POINTS points, and points sit on multiples of the step so
panning reuses them. Each point is cached for the hour; Open-Meteo is
asked for at most HOURLY_BUDGET new points an hour across the server
(its free tier counts every point), and past that the view gets what's
cached.
"""

import asyncio
import math
import time

import httpx

API = "https://air-quality-api.open-meteo.com/v1/air-quality"
FIELDS = (
    "us_aqi",
    "european_aqi",
    "pm2_5",
    "pm10",
    "ozone",
    "nitrogen_dioxide",
)
GRID_STEPS = (0.25, 0.5, 1.0, 2.0, 4.0, 8.0)
MAX_POINTS = 120
BATCH = 60
HOURLY_BUDGET = 3000
MAX_CACHED = 20000


def grid_step(w: float, s: float, e: float, n: float) -> float | None:
    """The smallest step that covers the view with MAX_POINTS points or
    fewer; None when even the largest can't."""
    for step in GRID_STEPS:
        cols = math.floor(e / step) - math.ceil(w / step) + 1
        rows = math.floor(n / step) - math.ceil(s / step) + 1
        if max(cols, 1) * max(rows, 1) <= MAX_POINTS:
            return step
    return None


def grid_points(
    w: float, s: float, e: float, n: float, step: float
) -> list[tuple[float, float]]:
    """Points on multiples of step inside the view, (lat, lon), or the
    view's centre when the view is smaller than one step."""
    pts = []
    for j in range(math.ceil(s / step), math.floor(n / step) + 1):
        for i in range(math.ceil(w / step), math.floor(e / step) + 1):
            lat, lon = round(j * step, 4), round(i * step, 4)
            if -85 <= lat <= 85 and -180 <= lon <= 180:
                pts.append((lat, lon))
    if not pts:
        lat = round(round((s + n) / 2 / step) * step, 4)
        lon = round(round((w + e) / 2 / step) * step, 4)
        pts.append((max(-85, min(85, lat)), max(-180, min(180, lon))))
    return pts


def parse_points(body, points: list[tuple[float, float]]) -> dict:
    """Open-Meteo's answer (one object, or a list for several points) by
    our point."""
    items = body if isinstance(body, list) else [body]
    out = {}
    for pt, item in zip(points, items, strict=False):
        cur = (item or {}).get("current") or {}
        if cur.get("us_aqi") is None:
            continue
        out[pt] = {k: cur.get(k) for k in FIELDS}
    return out


class AirQuality:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=8.0),
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )
        # (hour, lat, lon) -> fields, or None when Open-Meteo had none.
        self.cache: dict[tuple[int, float, float], dict | None] = {}
        self.spent: dict[int, int] = {}
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def _ask(self, points: list[tuple[float, float]]) -> dict:
        r = await self.client.get(
            API,
            params={
                "latitude": ",".join(str(p[0]) for p in points),
                "longitude": ",".join(str(p[1]) for p in points),
                "current": ",".join(FIELDS),
            },
        )
        r.raise_for_status()
        return parse_points(r.json(), points)

    async def grid(self, w: float, s: float, e: float, n: float) -> dict:
        step = grid_step(w, s, e, n)
        if step is None:
            return {"status": "zoom", "points": []}
        hour = int(time.time() // 3600)
        points = grid_points(w, s, e, n, step)
        status = "ok"
        async with self.lock:
            missing = [p for p in points if (hour, *p) not in self.cache]
            left = HOURLY_BUDGET - self.spent.get(hour, 0)
            if len(missing) > left:
                missing, status = missing[: max(left, 0)], "partial"
            for i in range(0, len(missing), BATCH):
                batch = missing[i : i + BATCH]
                self.spent[hour] = self.spent.get(hour, 0) + len(batch)
                try:
                    got = await self._ask(batch)
                except (httpx.HTTPError, ValueError):
                    status = "partial"
                    break
                for p in batch:
                    self.cache[(hour, *p)] = got.get(p)
            # Drop past hours, and the oldest entries past the cap.
            for k in [k for k in self.cache if k[0] != hour]:
                del self.cache[k]
            for h in [h for h in self.spent if h != hour]:
                del self.spent[h]
            while len(self.cache) > MAX_CACHED:
                del self.cache[next(iter(self.cache))]
            found = [
                {"lat": p[0], "lon": p[1]} | self.cache[(hour, *p)]
                for p in points
                if self.cache.get((hour, *p))
            ]
        return {
            "status": status,
            "step": step,
            "points": found,
            "source": "Open-Meteo (CAMS)",
        }

    async def point(self, lat: float, lon: float) -> dict:
        """One spot, on the finest grid (shares the grid's cache)."""
        step = GRID_STEPS[0]
        p = (
            max(-85.0, min(85.0, round(round(lat / step) * step, 4))),
            max(-180.0, min(180.0, round(round(lon / step) * step, 4))),
        )
        hour = int(time.time() // 3600)
        async with self.lock:
            key = (hour, *p)
            if key not in self.cache:
                if self.spent.get(hour, 0) >= HOURLY_BUDGET:
                    return {"status": "busy"}
                self.spent[hour] = self.spent.get(hour, 0) + 1
                try:
                    self.cache[key] = (await self._ask([p])).get(p)
                except (httpx.HTTPError, ValueError):
                    return {"status": "error"}
            hit = self.cache[key]
        if not hit:
            return {"status": "none"}
        return {"status": "ok", "source": "Open-Meteo (CAMS)"} | hit
