import json
import os
from datetime import UTC, datetime, timedelta

from argus.collectors.base import RawIn
from argus.collectors.weather import parse_alerts, parse_outlook
from argus.fusion import store_raw

HERE = os.path.join(os.path.dirname(__file__), "fixtures")
NOW = datetime(2026, 11, 19, 15, 0, tzinfo=UTC)


def load(name):
    with open(os.path.join(HERE, name)) as f:
        return json.load(f)


def test_parse_alerts():
    rows = parse_alerts(load("nws_alerts.json"), NOW)
    assert len(rows) == 4
    mapped = [r for r in rows if r.payload["polygons"]]
    assert len(mapped) == 2
    assert mapped[0].lat is not None
    zoned = [r for r in rows if not r.payload["polygons"]]
    assert zoned[0].payload["zones"][0].startswith("NEZ")
    assert zoned[0].lat is None
    assert rows[0].payload["url"].startswith("https://alerts.weather.gov/")


def test_parse_outlook():
    rows = parse_outlook(load("spc_day1.json"), 1, NOW)
    labels = {r.payload["label"]: r.payload for r in rows}
    assert labels["MRGL"]["level"] == 1
    assert labels["MRGL"]["title"] == "Level 1 (Marginal) severe storm risk"
    assert labels["TSTM"]["level"] == 0
    assert labels["MRGL"]["valid_to"].startswith("2026-11-20T12:00")


async def test_weather_endpoints(app, admin_client, monkeypatch):
    from argus.api import weather

    now = datetime.now(UTC)
    later = (now + timedelta(hours=2)).isoformat()

    def alert(key, polygons, zones):
        return RawIn(
            source="nws",
            external_id=key,
            kind="wxalert",
            observed_at=now,
            lat=36.0 if polygons else None,
            lon=-86.0 if polygons else None,
            payload={
                "event": "Tornado Warning",
                "headline": "Tornado Warning",
                "severity": 4,
                "expires": later,
                "polygons": polygons,
                "zones": zones,
            },
        )

    ring = [[-86, 36], [-85, 36], [-85, 37], [-86, 36]]
    async with app.state.db.sessionmaker() as db:
        await store_raw(
            db,
            [
                alert("a1", [ring], ["TNZ027"]),
                alert("a2", [], ["TNC037"]),
                alert("a3", [], ["KSZ002"]),
            ],
        )
        await db.commit()

    async def zones(request, lat, lon):
        return {"TNZ027", "TNC037"}

    monkeypatch.setattr(weather, "_home_zones", zones)
    body = (
        await admin_client.get("/api/weather/alerts?lat=36.16&lon=-86.78")
    ).json()
    assert [a["key"] for a in body["alerts"]] == ["a1"]
    assert sorted(a["key"] for a in body["local"]) == ["a1", "a2"]
    assert (await admin_client.get("/api/weather/outlook")).json() == {
        "areas": []
    }


def test_zone_rings_simplified():
    from argus.worker import zone_rings

    # A wiggly square: the simplifier keeps the corners.
    ring = [[0, 0]]
    ring += [[i / 100, 0.001 * (i % 2)] for i in range(1, 100)]
    ring += [[1, 0], [1, 1], [0, 1], [0, 0]]
    out = zone_rings({"type": "Polygon", "coordinates": [ring]})
    assert len(out) == 1
    assert len(out[0]) <= 6
    assert out[0][0] == [0.0, 0.0]


async def test_zoned_alerts_get_shapes(app, admin_client):
    from argus.models import NwsZone

    now = datetime.now(UTC)
    later = (now + timedelta(hours=2)).isoformat()
    ring = [[-90, 40], [-89, 40], [-89, 41], [-90, 40]]
    async with app.state.db.sessionmaker() as db:
        await store_raw(
            db,
            [
                RawIn(
                    source="nws",
                    external_id="z1",
                    kind="wxalert",
                    observed_at=now,
                    lat=None,
                    lon=None,
                    payload={
                        "event": "Wind Advisory",
                        "severity": 2,
                        "expires": later,
                        "polygons": [],
                        "zones": ["ILZ001", "ILZ999"],
                    },
                )
            ],
        )
        db.add(NwsZone(id="ILZ001", name="Somewhere", rings=[ring]))
        await db.commit()
    plain = (await admin_client.get("/api/weather/alerts")).json()
    assert plain["zoned"] == []
    body = (await admin_client.get("/api/weather/alerts?zones=1")).json()
    assert body["zoned"][0]["polygons"] == [ring]
    assert body["zoned"][0]["zoned"] is True


async def test_worker_fetches_missing_zones(app, monkeypatch):
    import httpx

    from argus import worker
    from argus.models import NwsZone

    monkeypatch.setattr(worker.asyncio, "sleep", _no_sleep)
    now = datetime.now(UTC)
    url = "https://api.weather.gov/zones/forecast/TNZ027"
    async with app.state.db.sessionmaker() as db:
        await store_raw(
            db,
            [
                RawIn(
                    source="nws",
                    external_id="w1",
                    kind="wxalert",
                    observed_at=now,
                    lat=None,
                    lon=None,
                    payload={"zones": ["TNZ027"], "zone_urls": [url]},
                )
            ],
        )
        await db.commit()
    calls = []

    def handler(request):
        calls.append(str(request.url))
        ring = [[-87, 36], [-86, 36], [-86, 37], [-87, 37], [-87, 36]]
        return httpx.Response(
            200,
            json={
                "properties": {"name": "Davidson"},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert await worker.zones_once(app.state.db, client) == 1
    # Already have it: no second request.
    assert await worker.zones_once(app.state.db, client) == 0
    assert calls == [url]
    async with app.state.db.sessionmaker() as db:
        zone = await db.get(NwsZone, "TNZ027")
        assert zone.name == "Davidson"
        assert len(zone.rings[0]) == 5
    await client.aclose()


async def _no_sleep(_seconds):
    return None
