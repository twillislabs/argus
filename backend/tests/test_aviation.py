import time

import httpx
import pytest

from argus import aviation, search
from argus.aviation import (
    AirClient,
    LiveAir,
    RateLimited,
    airlines,
    airports,
    normalise,
    radius_for_bbox,
    route_progress,
    snap_area,
)


def raw(hex_id="ae1234", **kw):
    ac = {
        "hex": hex_id,
        "flight": "RCH123  ",
        "r": "05-5140",
        "t": "C17",
        "lat": 36.1,
        "lon": -86.7,
        "alt_baro": 24000,
        "gs": 410.2,
        "track": 90.0,
        "squawk": "1234",
        "dbFlags": 1,
    }
    ac.update(kw)
    return ac


class FakeClient:
    def __init__(self, area=None, lookups=None):
        self.area_result = area or []
        self.lookups = lookups or {}
        self.area_calls = []

    async def area(self, lat, lon, radius_nm):
        self.area_calls.append((lat, lon, radius_nm))
        return self.area_result

    async def lookup(self, kind, value):
        return self.lookups.get((kind, value), [])

    async def route(self, callsign):
        return {
            "callsign": callsign,
            "flight": "DL1208",
            "airline": "Delta Air Lines",
            "origin": {"iata": "BOS", "lat": 42.36, "lon": -71.0},
            "destination": {"iata": "SFO", "lat": 37.62, "lon": -122.37},
        }

    async def detail(self, hex_id):
        return {"type": "757 351/W", "manufacturer": "Boeing"}

    def seen_recently(self, hex_id, max_age_s=30):
        return None

    async def close(self):
        pass


# --- records and live state ---------------------------------------------


def test_normalise_military():
    a = normalise(raw())
    assert a["mil"] and a["role"] == "Airlift"
    assert a["callsign"] == "RCH123"
    assert a["alt_ft"] == 24000 and not a["ground"]
    assert "owner" not in a


def test_normalise_privacy_and_ground():
    # PIA/LADD civil aircraft are dropped; military ones are kept.
    assert normalise(raw(dbFlags=8)) is None
    assert normalise(raw(dbFlags=4)) is None
    assert normalise(raw(dbFlags=1 | 8)) is not None
    assert normalise({"hex": "abc123"}) is None  # no position
    a = normalise(raw(dbFlags=0, alt_baro="ground", squawk="7700"))
    assert a["ground"] and a["alt_ft"] == 0
    assert a["emergency"] and not a["mil"] and a["role"] is None


def test_live_air_trails_and_staleness():
    air = LiveAir()
    a = normalise(raw())
    air.apply([a], now=1000)
    air.apply([dict(a, lon=-86.6)], now=1015)
    air.apply([dict(a, lon=-86.6)], now=1030)  # same spot: no new point
    assert len(air.trails["ae1234"]) == 2
    assert air.find("rch123")[0]["hex"] == "ae1234"
    air.apply([], now=1030 + LiveAir.STALE_S + 1)
    assert air.aircraft == {} and air.trails == {}


def test_live_air_bbox_across_antimeridian():
    air = LiveAir()
    air.apply(
        [
            normalise(raw("aaaaaa", lon=179.5)),
            normalise(raw("bbbbbb", lon=-179.5)),
            normalise(raw("cccccc", lon=10.0)),
        ]
    )
    inside = {a["hex"] for a in air.in_bbox((170, 30, -170, 40))}
    assert inside == {"aaaaaa", "bbbbbb"}


def test_radius_and_progress():
    lat, lon, radius = radius_for_bbox((-88, 35, -85, 37.5))
    assert 35 < lat < 37.5 and -88 < lon < -85
    assert 50 < radius <= 250
    assert radius_for_bbox((-180, -80, 180, 80)) is None
    route = {
        "origin": {"lat": 36.12, "lon": -86.68},
        "destination": {"lat": 33.64, "lon": -84.43},
    }
    p = route_progress(route, 34.9, -85.5)
    assert 0.3 < p["fraction"] < 0.7
    assert p["plausible"]
    # Over Tennessee "on" a Las Vegas to Los Angeles route: not this flight.
    stale = {
        "origin": {"lat": 36.08, "lon": -115.15},
        "destination": {"lat": 33.94, "lon": -118.41},
    }
    assert not route_progress(stale, 35.9, -88.0)["plausible"]
    assert route_progress({"origin": None}, 0, 0) is None


def test_snap_area():
    assert snap_area(36.13, -86.71, 221) == (36.25, -86.75, 250)
    assert snap_area(36.13, -86.71, 30) == (36.25, -86.75, 50)


async def test_area_backs_off_and_serves_cache(monkeypatch):
    monkeypatch.setattr(aviation, "MIN_GAP_S", 0)
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) == 1:
            return httpx.Response(200, json={"ac": [raw(dbFlags=0)]})
        return httpx.Response(429, headers={"Retry-After": "60"})

    client = AirClient("test")
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    first = await client.area(36.1, -86.7, 100)
    assert [a["hex"] for a in first] == ["ae1234"]
    assert client.seen_recently("ae1234")["callsign"] == "RCH123"
    # Fresh cache: no request at all.
    assert await client.area(36.12, -86.72, 90) == first
    # Expire it: adsb.lol says 429, the stale answer is served.
    client.areas.items = {
        k: (time.time() - 60, v) for k, (_, v) in client.areas.items.items()
    }
    assert await client.area(36.1, -86.7, 100) == first
    assert client.limited()
    # Paused: no further requests, and nothing cached elsewhere raises.
    with pytest.raises(RateLimited):
        await client.area(10.0, 10.0, 100)
    assert len(calls) == 2
    assert await client.lookup("hex", "abcdef") == []
    await client.close()


def test_reference_data():
    assert airports()["KBNA"].iata == "BNA"
    assert airports()["BNA"].icao == "KBNA"
    by_iata, by_icao = airlines()
    assert by_iata["AA"].icao == "AAL"
    assert by_icao["DAL"].iata == "DL"


# --- the decoder ---------------------------------------------------------


def kinds(q):
    return [(r.kind, r.value) for r in search.decode(q)]


def test_decode_flights_and_aircraft():
    assert ("flight", "AAL100") in kinds("AA100")
    assert ("flight", "AAL100") in kinds("aa 0100")
    assert ("flight", "DAL1234") in kinds("DAL 1234")
    assert ("hex", "ae1234") in kinds("AE1234")
    assert ("reg", "N12345") in kinds("n12345")
    assert ("reg", "G-ABCD") in kinds("G-ABCD")
    assert kinds("7700")[0] == ("squawk", "7700")
    assert not any(k == "flight" for k, _ in kinds("7700"))


def test_decode_places_and_filters():
    assert kinds("36.3, -86.7") == [("coords", (36.3, -86.7))]
    assert kinds("36.3 -86.7") == [("coords", (36.3, -86.7))]
    assert not any(k == "coords" for k, _ in kinds("95, 10"))
    airport = [r for r in search.decode("BNA") if r.kind == "airport"]
    assert airport and airport[0].value.icao == "KBNA"
    assert ("events_filter", ["quake"]) in kinds("earthquakes in japan")
    assert ("aircraft_filter", "Tanker") in kinds("tankers")
    assert ("aircraft_filter", "military") in kinds("military")
    assert kinds("Goodlettsville") == []
    assert kinds("   ") == []


# --- the API ---------------------------------------------------------------


async def test_aircraft_require_sign_in(client):
    for path in (
        "/api/aircraft",
        "/api/aircraft/ae1234",
        "/api/search?q=AA100",
    ):
        assert (await client.get(path)).status_code == 401, path


async def test_list_aircraft_merges_civil(admin_client, app):
    app.state.air.apply([normalise(raw())])
    civil = normalise(raw("a789bc", flight="DAL1208", t="B753", dbFlags=0))
    far = normalise(raw("a00001", dbFlags=0, lon=-120.0))
    fake = FakeClient(area=[civil, far, normalise(raw())])
    app.state.air_client = fake

    world = (await admin_client.get("/api/aircraft")).json()
    assert [a["hex"] for a in world["aircraft"]] == ["ae1234"]
    assert world["civil_status"] == "zoom"

    body = (
        await admin_client.get("/api/aircraft?bbox=-88,35,-85,37.5")
    ).json()
    assert body["civil_status"] == "ok"
    assert {a["hex"] for a in body["aircraft"]} == {"ae1234", "a789bc"}
    assert len(fake.area_calls) == 1

    wide = (
        await admin_client.get("/api/aircraft?bbox=-170,-60,170,60")
    ).json()
    assert wide["civil_status"] == "zoom"


async def test_aircraft_detail(admin_client, app):
    civil = normalise(raw("a789bc", flight="DAL1208", t="B753", dbFlags=0))
    app.state.air_client = FakeClient(lookups={("hex", "a789bc"): [civil]})
    body = (await admin_client.get("/api/aircraft/A789BC")).json()
    assert body["aircraft"]["callsign"] == "DAL1208"
    assert body["route"]["flight"] == "DL1208"
    assert 0 <= body["progress"]["fraction"] <= 1
    assert body["detail"]["manufacturer"] == "Boeing"
    assert (await admin_client.get("/api/aircraft/zzzzzz")).status_code == 422
    assert (await admin_client.get("/api/aircraft/abcdef")).status_code == 404


async def test_search_endpoint(admin_client, app):
    app.state.air.apply([normalise(raw(squawk="7700"))])
    civil = normalise(raw("a00002", flight="AAL100", t="B77W", dbFlags=0))
    app.state.air_client = FakeClient(
        lookups={("callsign", "AAL100"): [civil]}
    )

    async def results(q):
        r = await admin_client.get("/api/search", params={"q": q})
        assert r.status_code == 200, r.text
        return r.json()["results"]

    hit = (await results("AA100"))[0]
    assert hit["kind"] == "aircraft" and hit["hex"] == "a00002"
    assert "American Airlines" in hit["detail"]

    live = await results("rch123")
    assert live[0]["hex"] == "ae1234"

    squawk = await results("7700")
    assert squawk[0]["hex"] == "ae1234"
    assert squawk[-1]["filter"] == {"aircraft": "emergency"}

    missing = await results("UA9999")
    assert missing[0]["kind"] == "flight"
    assert "not airborne" in missing[0]["detail"]

    place = await results("Goodlettsville, TN")
    assert place[0]["kind"] == "place"
    assert "Goodlettsville" in place[0]["label"]

    quakes = await results("earthquakes")
    assert quakes[0]["filter"] == {"events": ["quake"]}
