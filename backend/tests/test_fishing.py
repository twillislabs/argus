import json

import httpx
import pytest

from argus import fishing

ENCOUNTER = {
    "id": "enc1",
    "type": "encounter",
    "start": "2026-11-10T02:00:00.000Z",
    "end": "2026-11-10T06:30:00.000Z",
    "position": {"lat": -20.51234, "lon": -79.1},
    "regions": {"highSeas": ["1"]},
    "distances": {"startDistanceFromShoreKm": 320.5},
    "vessel": {
        "id": "v1",
        "name": "OCEAN ONE",
        "ssvid": "412000001",
        "flag": "CHN",
        "type": "carrier",
    },
    "encounter": {
        "vessel": {"id": "v2", "name": "FISHER", "flag": "CHN"},
        "medianDistanceKilometers": 0.04,
        "medianSpeedKnots": 1.2,
    },
}
GAP = {
    "id": "gap1",
    "type": "gap",
    "start": "2026-11-11T00:00:00Z",
    "end": "2026-11-12T12:00:00Z",
    "position": {"lat": -21.0, "lon": -78.0},
    "vessel": {"id": "v3", "name": "", "ssvid": "1"},
}


def test_parse_event():
    e = fishing.parse_event(ENCOUNTER)
    assert e["kind"] == "encounter" and e["lat"] == -20.5123
    assert e["vessel"]["name"] == "OCEAN ONE" and e["eez"] == "High seas"
    assert e["other"]["name"] == "FISHER" and e["speed_kn"] == 1.2
    assert e["hours"] == 4.5 and e["shore_km"] == 320.5
    g = fishing.parse_event(GAP)
    assert g["kind"] == "gap" and g["hours"] == 36.0
    assert g["vessel"]["name"] is None
    assert fishing.parse_event({"id": "x", "type": "port_visit"}) is None
    assert fishing.parse_event({"id": "x", "type": "gap"}) is None


def test_tiles():
    assert fishing.tiles((-80, -22, -76, -19)) == [
        (-16, -5),
        (-16, -4),
    ]
    assert fishing.tiles((-100, -40, 0, 40)) is None


async def test_area_skips_refused_dataset():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        ds = body["datasets"][0]
        calls.append(ds)
        assert request.headers["authorization"] == "Bearer tok"
        if "gaps" in ds:
            return httpx.Response(403, json={"detail": "nope"})
        entries = [ENCOUNTER] if "encounters" in ds else []
        return httpx.Response(
            200, json={"entries": entries, "total": len(entries)}
        )

    f = fishing.Fishing("test")
    f.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    found = await f.area("tok", (-80, -22, -78, -20))
    assert [e["id"] for e in found] == ["enc1"]
    assert fishing.DATASETS["gap"] in f.refused
    # Cached: no more calls for the same view.
    n = len(calls)
    await f.area("tok", (-80, -22, -78, -20))
    assert len(calls) == n
    await f.close()


async def test_area_token_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "bad token"})

    f = fishing.Fishing("test")
    f.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(fishing.Forbidden):
        await f.area("tok", (-80, -22, -78, -20))
    await f.close()


async def test_api_nokey(admin_client):
    r = await admin_client.get("/api/fishing?bbox=-80,-22,-78,-20")
    assert r.status_code == 200 and r.json()["status"] == "nokey"
