import asyncio

import httpx

from argus import sea, worker
from argus.aviation import GpsGrid, hex_cell, hex_centre
from argus.models import ServerSetting
from tests.conftest import csrf
from tests.test_aviation import FakeClient


def plane(hex_id, lat, lon, nac_p):
    return {
        "hex": hex_id,
        "lat": lat,
        "lon": lon,
        "nac_p": nac_p,
        "ground": False,
    }


def test_gps_grid_levels():
    grid = GpsGrid()
    now = 1_000_000.0
    # Ten aircraft in one cell, three of them degraded: 30%, high.
    grid.observe(
        [
            plane("a{0}".format(i), 55.5, 20.5, 3 if i < 3 else 10)
            for i in range(10)
        ],
        now=now,
    )
    # Too few to judge in another cell.
    grid.observe([plane("b1", 10.5, 10.5, 2)], now=now)
    cells = grid.summary(now=now)
    assert len(cells) == 1
    c = cells[0]
    # The centre of the hexagon the aircraft are in, within one radius.
    assert abs(c["lat"] - 55.5) <= 0.5 and abs(c["lon"] - 20.5) <= 1.0
    assert c["aircraft"] == 10 and c["bad"] == 3 and c["level"] == "high"
    # An hour later it has aged out.
    assert grid.summary(now=now + 3601) == []


def test_hex_cells_tile_the_map():
    # Every point belongs to the cell whose centre is nearest, and the
    # centre maps back to its own cell.
    for lat, lon in ((0.1, 0.1), (55.5, 20.5), (-33.9, 151.2), (64, -150)):
        row, col = hex_cell(lat, lon)
        clat, clon = hex_centre(row, col)
        assert hex_cell(clat, clon) == (row, col)
        assert abs(clat - lat) <= 0.5
    # Neighbouring points a cell apart land in different cells.
    assert hex_cell(40.0, 10.0) != hex_cell(40.0, 11.5)


def test_parse_aiscatcher():
    doc = {
        "ships": [
            {
                "mmsi": 367000001,
                "lat": 36.1,
                "lon": -86.7,
                "speed": 5.2,
                "cog": 90,
                "heading": 511,
                "shipname": "RIVER QUEEN ",
                "shiptype": 52,
                "last_signal": 4,
            },
            {"mmsi": 2, "lat": 91, "lon": 181},
            {"mmsi": 3},
        ]
    }
    ships = sea.parse_aiscatcher(doc)
    assert len(ships) == 1
    s = ships[0]
    assert s["name"] == "RIVER QUEEN" and s["heading"] is None
    assert s["ship_type"] == 52 and s["source"] == "local"


async def test_receivers_api(admin_client):
    r = await admin_client.put(
        "/api/admin/receivers",
        json={"adsb_url": "ftp://nope", "ais_url": ""},
        headers=csrf(admin_client),
    )
    assert r.status_code == 422
    r = await admin_client.put(
        "/api/admin/receivers",
        json={"adsb_url": "http://192.168.1.50:8080/data/aircraft.json"},
        headers=csrf(admin_client),
    )
    assert r.json() == {
        "adsb_url": "http://192.168.1.50:8080/data/aircraft.json",
        "ais_url": None,
    }
    assert (await admin_client.get("/api/admin/receivers")).json()["adsb_url"]


async def test_receivers_loop_publishes(app):
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="receivers",
                value={
                    "adsb_url": "http://rx.local/data/aircraft.json",
                    "ais_url": "http://rx.local/ships.json",
                },
            )
        )
        await db.commit()

    def handler(request):
        if request.url.path.endswith("aircraft.json"):
            return httpx.Response(
                200,
                json={
                    "aircraft": [
                        {
                            "hex": "a1b2c3",
                            "flight": "N123AB ",
                            "lat": 36.2,
                            "lon": -86.6,
                            "alt_baro": 3500,
                            "nac_p": 9,
                        }
                    ]
                },
            )
        return httpx.Response(
            200,
            json={"ships": [{"mmsi": 367000001, "lat": 36.1, "lon": -86.7}]},
        )

    published = []

    class FakePublisher:
        async def publish(self, message, subject="argus.events"):
            published.append((subject, message))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    task = asyncio.create_task(
        worker.receivers_loop(app.state.db, client, FakePublisher())
    )
    for _ in range(50):
        if len({s for s, _ in published}) >= 2:
            break
        await asyncio.sleep(0.05)
    task.cancel()
    await client.aclose()
    subjects = {s for s, _ in published}
    assert subjects == {"argus.local_air", "argus.sea"}
    air = next(m for s, m in published if s == "argus.local_air")
    assert air["aircraft"][0]["source"] == "local"
    assert air["aircraft"][0]["nac_p"] == 9


async def test_local_aircraft_in_api(admin_client, app):
    from argus.aviation import normalise

    a = normalise(
        {
            "hex": "a1b2c3",
            "flight": "N123AB",
            "lat": 36.2,
            "lon": -86.6,
            "alt_baro": 3500,
        }
    )
    a["source"] = "local"
    app.state.local_air.apply([a])
    app.state.air_client = FakeClient()
    r = (
        await admin_client.get("/api/aircraft?bbox=-90,30,-80,40&civil=false")
    ).json()
    assert [x["hex"] for x in r["aircraft"]] == ["a1b2c3"]
    detail = (await admin_client.get("/api/aircraft/a1b2c3")).json()
    assert detail["aircraft"]["callsign"] == "N123AB"
    gps = (await admin_client.get("/api/gps")).json()
    assert gps["cells"] == []


async def test_cables_loop_and_api(admin_client, app):
    from argus.models import Source

    def handler(request):
        if "landing" in request.url.path:
            return httpx.Response(
                200, json={"features": [{"properties": {"name": "Cork"}}]}
            )
        return httpx.Response(
            200,
            json={
                "features": [
                    {
                        "properties": {
                            "id": "x",
                            "name": "X",
                            "color": "#fff",
                        },
                        "geometry": {
                            "type": "MultiLineString",
                            "coordinates": [[[0, 0], [1, 1]]],
                        },
                    }
                ]
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    task = asyncio.create_task(worker.cables_loop(app.state.db, client))
    for _ in range(50):
        async with app.state.db.sessionmaker() as db:
            if await db.get(ServerSetting, "layer:cables"):
                break
        await asyncio.sleep(0.05)
    task.cancel()
    await client.aclose()
    body = (await admin_client.get("/api/layers/cables")).json()
    assert body["cables"]["features"][0]["properties"]["name"] == "X"
    assert body["landings"]["features"][0]["properties"]["name"] == "Cork"
    async with app.state.db.sessionmaker() as db:
        assert (await db.get(Source, "cables")).last_count == 1
