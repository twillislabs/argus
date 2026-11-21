"""Wind at 10 m worldwide, for the map's animated wind.

From NOAA's GFS model through PacIOOS's ERDDAP server (no key; "may be
used and redistributed for free"): eastward and northward wind on a 1
degree grid for the model's 3-hourly step nearest now. Fetched on
demand, once a step, and kept in memory.
"""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import httpx

ERDDAP = (
    "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncep_global.json"
    "?ugrd10m[({0})][(-90):{1}:(90)][(0):{1}:(359.5)]"
    ",vgrd10m[({0})][(-90):{1}:(90)][(0):{1}:(359.5)]"
)
# The dataset's grid is 0.5 degrees: every second point is 1 degree.
STRIDE = 2
STEP_H = 3
# A failed fetch is retried after this long, not on every request.
RETRY_S = 300


def model_step(now: datetime) -> datetime:
    """The model step (every 3 hours, UTC) nearest now."""
    base = now.replace(minute=0, second=0, microsecond=0)
    hours = round((base.hour + now.minute / 60) / STEP_H) * STEP_H
    return base.replace(hour=0) + timedelta(hours=hours)


def parse_grid(table: dict) -> dict:
    """ERDDAP's rows (time, latitude, longitude, u, v) as a regular grid:
    rows from north to south, columns east from 0 degrees, speeds in m/s
    to one decimal (missing values as 0)."""
    cols = table.get("columnNames") or []
    rows = table.get("rows") or []
    try:
        ilat, ilon = cols.index("latitude"), cols.index("longitude")
        iu, iv = cols.index("ugrd10m"), cols.index("vgrd10m")
    except ValueError as exc:
        raise ValueError("unexpected columns: {0}".format(cols)) from exc
    lats = sorted({float(r[ilat]) for r in rows}, reverse=True)
    lons = sorted({float(r[ilon]) for r in rows})
    if len(lats) < 2 or len(lons) < 2:
        raise ValueError("too few points")
    nx, ny = len(lons), len(lats)
    col = {v: i for i, v in enumerate(lons)}
    row = {v: i for i, v in enumerate(lats)}
    u = [0.0] * (nx * ny)
    v = [0.0] * (nx * ny)
    for r in rows:
        i = row[float(r[ilat])] * nx + col[float(r[ilon])]
        u[i] = round(float(r[iu]), 1) if r[iu] is not None else 0.0
        v[i] = round(float(r[iv]), 1) if r[iv] is not None else 0.0
    return {
        "lat0": lats[0],
        "lon0": lons[0],
        "dlat": round(lats[0] - lats[1], 4),
        "dlon": round(lons[1] - lons[0], 4),
        "nx": nx,
        "ny": ny,
        "u": u,
        "v": v,
    }


class Wind:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            headers={"User-Agent": user_agent},
            follow_redirects=False,
        )
        self.cache: dict | None = None
        self.failed_at = 0.0
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        await self.client.aclose()

    async def get(self) -> dict:
        step = model_step(datetime.now(UTC)).strftime("%Y-%m-%dT%H:00:00Z")
        async with self.lock:
            if self.cache and self.cache["time"] == step:
                return self.cache
            if time.monotonic() - self.failed_at < RETRY_S:
                return self.cache or {"status": "error"}
            try:
                r = await self.client.get(ERDDAP.format(step, STRIDE))
                r.raise_for_status()
                grid = parse_grid(r.json().get("table") or {})
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                self.failed_at = time.monotonic()
                # The last step's wind beats none while NOAA is away.
                return self.cache or {
                    "status": "error",
                    "error": str(exc)[:200],
                }
            self.cache = {
                "status": "ok",
                "time": step,
                "source": "NOAA GFS via PacIOOS ERDDAP",
            } | grid
            return self.cache
