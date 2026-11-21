from datetime import UTC, datetime

import httpx

from argus import airquality, wind


def test_model_step():
    def at(h, m):
        return datetime(2026, 11, 21, h, m, tzinfo=UTC)

    assert wind.model_step(at(4, 20)).hour == 3
    assert wind.model_step(at(4, 31)).hour == 6
    nxt = wind.model_step(at(22, 40))
    assert (nxt.day, nxt.hour) == (22, 0)


def test_parse_grid():
    rows = []
    for lat in (90, 89, 88):
        for lon in (0, 1, 2, 3):
            rows.append(["t", lat, lon, lat / 10 + lon, None])
    grid = wind.parse_grid(
        {
            "columnNames": [
                "time",
                "latitude",
                "longitude",
                "ugrd10m",
                "vgrd10m",
            ],
            "rows": list(reversed(rows)),  # any order
        }
    )
    assert (grid["nx"], grid["ny"]) == (4, 3)
    assert (grid["lat0"], grid["lon0"]) == (90, 0)
    assert (grid["dlat"], grid["dlon"]) == (1, 1)
    assert grid["u"][0] == 9.0  # north-west corner first
    assert grid["u"][5] == 9.9  # row 89, column 1
    assert set(grid["v"]) == {0.0}


def test_grid_step_and_points():
    assert airquality.grid_step(-97.5, 32.5, -96.5, 33.0) == 0.25
    assert airquality.grid_step(-125, 25, -65, 50) == 4.0
    assert airquality.grid_step(-180, -85, 180, 85) is None
    pts = airquality.grid_points(-97.6, 32.6, -97.1, 32.9, 0.25)
    assert (32.75, -97.5) in pts and len(pts) == 2
    # Smaller than a step: the view's centre, snapped.
    assert airquality.grid_points(-97.01, 32.71, -97.0, 32.72, 0.25) == [
        (32.75, -97.0)
    ]
    for w, s, e, n in ((-120, 20, -60, 55), (0, 40, 30, 60)):
        step = airquality.grid_step(w, s, e, n)
        n_pts = len(airquality.grid_points(w, s, e, n, step))
        assert n_pts <= airquality.MAX_POINTS


async def test_air_quality_cache_and_budget(monkeypatch):
    asked = []

    def handler(request):
        lats = request.url.params["latitude"].split(",")
        asked.append(len(lats))
        body = [
            {"current": {"us_aqi": 40 + i, "pm2_5": 5.0}}
            for i in range(len(lats))
        ]
        return httpx.Response(200, json=body if len(lats) > 1 else body[0])

    aq = airquality.AirQuality("test")
    aq.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    view = (-97.6, 32.4, -96.4, 33.1)
    first = await aq.grid(*view)
    assert first["status"] == "ok" and first["step"] == 0.25
    assert len(first["points"]) == sum(asked)
    assert first["points"][0]["us_aqi"] == 40
    await aq.grid(*view)
    assert len(asked) == 1  # cached for the hour
    here = await aq.point(32.74, -97.49)  # snaps to a cached point
    assert here["status"] == "ok" and len(asked) == 1

    monkeypatch.setattr(airquality, "HOURLY_BUDGET", 0)
    aq.cache.clear()
    aq.spent.clear()
    out = await aq.grid(*view)
    assert out["status"] == "partial" and out["points"] == []
    assert (await aq.point(10, 10))["status"] == "busy"


async def test_wind_keeps_last_step_when_noaa_fails():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) > 1:
            return httpx.Response(503)
        rows = [
            ["t", lat, lon, 1.0, 2.0] for lat in (90, 89) for lon in (0, 1)
        ]
        return httpx.Response(
            200,
            json={
                "table": {
                    "columnNames": [
                        "time",
                        "latitude",
                        "longitude",
                        "ugrd10m",
                        "vgrd10m",
                    ],
                    "rows": rows,
                }
            },
        )

    w = wind.Wind("test")
    w.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    ok = await w.get()
    assert ok["status"] == "ok" and ok["u"] == [1.0] * 4
    assert (await w.get()) is ok and len(calls) == 1
    w.cache["time"] = "old"  # the next step is due
    assert (await w.get())["u"] == [1.0] * 4  # NOAA down: last step
    assert (await w.get())["u"] == [1.0] * 4
    assert len(calls) == 2  # and no retry for a while
