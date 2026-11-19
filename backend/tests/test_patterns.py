import math
from collections import deque

from argus import patterns
from argus.aviation import LiveAir
from argus.sea import LiveSea


def circle(lat, lon, radius_km, laps, points, start=0.0, step=30.0, alt=24000):
    out = []
    for i in range(points):
        a = 2 * math.pi * laps * i / points
        dlat = radius_km * math.cos(a) / 111.32
        dlon = radius_km * math.sin(a) / (111.32 * math.cos(math.radians(lat)))
        out.append((lon + dlon, lat + dlat, alt, start + i * step))
    return out


def live_air(track, mil=True):
    air = LiveAir()
    air.aircraft["ae1234"] = {
        "hex": "ae1234",
        "callsign": "QID61",
        "type": "K35R",
        "role": "tanker",
        "mil": mil,
        "alt_ft": 24000,
    }
    air.trails["ae1234"] = deque(track)
    return air


def test_orbit_found():
    track = circle(33.0, 35.0, 20, laps=2, points=80)
    now = track[-1][3]
    found = patterns.air_patterns(live_air(track), now)
    assert len(found) == 1
    p = found[0]
    assert p["kind"] == "orbit" and p["callsign"] == "QID61"
    assert 1.5 <= p["laps"] <= 2.1 and p["radius_km"] < 25
    assert p["role"] == "tanker"


def test_straight_line_and_civil_ignored():
    line = [(35.0 + i * 0.05, 33.0, 30000, i * 30.0) for i in range(80)]
    assert patterns.air_patterns(live_air(line), line[-1][3]) == []
    track = circle(33.0, 35.0, 20, laps=2, points=80)
    assert (
        patterns.air_patterns(live_air(track, mil=False), track[-1][3]) == []
    )


def test_ship_loitering_on_a_cable():
    cables = patterns.CableIndex(
        {
            "features": [
                {
                    "properties": {"name": "Test Cable"},
                    "geometry": {
                        "type": "MultiLineString",
                        "coordinates": [[[20.0, 58.0], [21.0, 58.0]]],
                    },
                }
            ]
        }
    )
    sea = LiveSea()
    t0 = 1_000_000.0
    for i in range(30):
        sea.apply(
            [
                {
                    "mmsi": 211000001,
                    "lat": 58.01 + (i % 2) * 0.001,
                    "lon": 20.5,
                    "sog": 1.2,
                    "pos_at": t0 + i * 300,
                }
            ],
            now=t0 + i * 300,
        )
    found = patterns.sea_patterns(sea, cables, now=t0 + 29 * 300)
    assert [p["mmsi"] for p in found] == [211000001]
    assert found[0]["cable"] == "Test Cable" and found[0]["cable_km"] < 2
    assert found[0]["hours"] >= 2
    # Far from any cable: nothing.
    far = patterns.CableIndex({"features": []})
    assert patterns.sea_patterns(sea, far, now=t0 + 29 * 300) == []


async def test_patterns_endpoint(admin_client):
    body = (await admin_client.get("/api/patterns")).json()
    assert body == {"air": [], "sea": []}
