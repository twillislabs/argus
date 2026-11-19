import time

from argus import sea, secrets
from argus.models import ServerSetting
from argus.worker import read_key
from tests.conftest import csrf

POSITION = {
    "MessageType": "PositionReport",
    "MetaData": {
        "MMSI": 366123456,
        "ShipName": "EVER GIVEN   ",
        "latitude": 30.01,
        "longitude": 32.55,
        "time_utc": "2026-11-19 01:00:00",
    },
    "Message": {
        "PositionReport": {
            "UserID": 366123456,
            "Latitude": 30.01,
            "Longitude": 32.55,
            "Sog": 11.4,
            "Cog": 352.1,
            "TrueHeading": 351,
            "NavigationalStatus": 0,
        }
    },
}

STATIC = {
    "MessageType": "ShipStaticData",
    "MetaData": {"MMSI": 366123456, "ShipName": "EVER GIVEN"},
    "Message": {
        "ShipStaticData": {
            "UserID": 366123456,
            "Name": "EVER GIVEN",
            "CallSign": "H3RC",
            "ImoNumber": 9811000,
            "Type": 71,
            "Destination": "ROTTERDAM",
            "MaximumStaticDraught": 14.5,
            "Dimension": {"A": 300, "B": 100, "C": 30, "D": 29},
            "Eta": {"Month": 11, "Day": 30, "Hour": 6, "Minute": 0},
        }
    },
}


def test_parse_and_merge():
    pos = sea.parse(POSITION)
    assert pos["mmsi"] == 366123456 and pos["name"] == "EVER GIVEN"
    assert pos["sog"] == 11.4 and pos["heading"] == 351
    assert pos["status"] == "Under way using engine"
    static = sea.parse(STATIC)
    assert static["imo"] == 9811000 and static["length"] == 400
    assert static["eta"] == "11-30 06:00"
    live = sea.LiveSea()
    live.apply([pos, static])
    v = sea.public(live.vessels[366123456])
    assert v["category"] == "cargo" and v["type"] == "Cargo"
    assert v["flag"] == "United States"
    assert v["lat"] == 30.01 and v["destination"] == "ROTTERDAM"


def test_not_available_values_are_dropped():
    msg = {
        "MessageType": "PositionReport",
        "MetaData": {"MMSI": 1},
        "Message": {
            "PositionReport": {
                "Latitude": 91,
                "Longitude": 181,
            }
        },
    }
    assert sea.parse(msg) is None
    msg["Message"]["PositionReport"].update(
        {"Latitude": 10, "Longitude": 10, "Sog": 102.3, "TrueHeading": 511}
    )
    p = sea.parse(msg)
    assert p["sog"] is None and p["heading"] is None
    assert sea.parse({"MessageType": "Unknown"}) is None


def test_categories_and_flags():
    assert sea.category(35) == "military" and sea.category(55) == "military"
    assert sea.category(84) == "tanker" and sea.category(30) == "fishing"
    assert sea.category(None) == "other"
    assert sea.flag(538001234) == "Marshall Islands"
    assert sea.flag(12345) is None


def test_live_sea_bbox_prune_find():
    live = sea.LiveSea()
    now = time.time()
    live.apply(
        [
            dict(sea.parse(POSITION), ship_type=80),
            {
                "mmsi": 2,
                "lat": 50.0,
                "lon": 1.0,
                "pos_at": now,
                "ship_type": 35,
            },
            {"mmsi": 3, "lat": 50.1, "lon": 1.1, "pos_at": now, "sog": 12},
            {"mmsi": 4, "lat": 0, "lon": 0, "pos_at": now - 7 * 3600},
        ]
    )
    hits, total = live.in_bbox((0, 45, 5, 55))
    assert total == 2 and [v["mmsi"] for v in hits] == [2, 3]
    assert live.prune(now) == 1 and 4 not in live.vessels
    # A moving vessel that stops reporting goes after 30 minutes.
    assert live.prune(now + 31 * 60) == 2
    live.apply([sea.parse(POSITION), sea.parse(STATIC)])
    assert live.find("ever g")[0]["mmsi"] == 366123456
    assert live.find("9811000")[0]["mmsi"] == 366123456
    assert live.find("H3RC")[0]["mmsi"] == 366123456


async def test_vessel_api_and_search(admin_client, app):
    r = (await admin_client.get("/api/vessels")).json()
    assert r["status"] == "nokey" and r["vessels"] == []
    app.state.sea.apply([sea.parse(POSITION), sea.parse(STATIC)])
    r = (await admin_client.get("/api/vessels?bbox=30,25,35,35")).json()
    assert r["status"] == "ok" and r["total"] == 1
    assert r["vessels"][0]["name"] == "EVER GIVEN"
    detail = (await admin_client.get("/api/vessels/366123456")).json()
    assert detail["imo"] == 9811000
    assert (await admin_client.get("/api/vessels/1")).status_code == 404

    async def results(q):
        r = await admin_client.get("/api/search", params={"q": q})
        return r.json()["results"]

    assert (await results("366123456"))[0]["mmsi"] == 366123456
    assert (await results("IMO 9811000"))[0]["kind"] == "vessel"
    assert any(x.get("mmsi") for x in await results("ever given"))


async def test_keys_api_and_worker_read(admin_client, app):
    view = (await admin_client.get("/api/admin/keys")).json()
    assert view["aisstream"]["set"] is False
    r = await admin_client.put(
        "/api/admin/keys",
        json={"aisstream": "abcdef0123456789"},
        headers=csrf(admin_client),
    )
    assert r.json()["aisstream"]["hint"] == "…6789"
    assert "abcdef0123456789" not in r.text
    async with app.state.db.sessionmaker() as db:
        row = await db.get(ServerSetting, "keys")
        assert "abcdef" not in str(row.value)
        assert (
            secrets.decrypt(
                app.state.settings.secret_key, row.value["aisstream"]
            )
            == "abcdef0123456789"
        )
    assert (
        await read_key(app.state.db, app.state.settings, "aisstream")
        == "abcdef0123456789"
    )
    # The vessel API now says it's waiting for data, not for a key.
    assert (await admin_client.get("/api/vessels")).json()[
        "status"
    ] == "waiting"
    r = await admin_client.put(
        "/api/admin/keys", json={"aisstream": ""}, headers=csrf(admin_client)
    )
    assert r.json()["aisstream"]["set"] is False


async def test_sea_loop_against_a_fake_aisstream(app, monkeypatch):
    """The worker subscribes with the key and the whole world, merges
    messages per vessel and publishes them on argus.sea."""
    import asyncio
    import json

    from websockets.asyncio.server import serve

    from argus import worker

    subscriptions = []

    async def handler(ws):
        subscriptions.append(json.loads(await ws.recv()))
        await ws.send(json.dumps(POSITION))
        await ws.send(json.dumps(STATIC))
        await asyncio.sleep(0.3)
        # A message after the flush interval makes the loop publish.
        await ws.send(json.dumps(POSITION))
        await asyncio.sleep(5)

    published = []

    class FakePublisher:
        async def publish(self, message, subject="argus.events"):
            published.append((subject, message))

    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="keys",
                value={
                    "aisstream": secrets.encrypt(
                        app.state.settings.secret_key, "test-key"
                    )
                },
            )
        )
        await db.commit()
    monkeypatch.setattr(worker, "SEA_FLUSH_S", 0.2)
    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setattr(
            sea, "AISSTREAM_URL", "ws://127.0.0.1:{0}".format(port)
        )
        task = asyncio.create_task(
            worker.sea_loop(app.state.db, app.state.settings, FakePublisher())
        )
        for _ in range(50):
            if published:
                break
            await asyncio.sleep(0.1)
        task.cancel()
    assert subscriptions[0]["APIKey"] == "test-key"
    assert subscriptions[0]["BoundingBoxes"] == [[[-90, -180], [90, 180]]]
    subject, message = published[0]
    assert subject == "argus.sea" and message["type"] == "vessels"
    merged = message["vessels"][0]
    assert merged["mmsi"] == 366123456 and merged["imo"] == 9811000
    assert merged["lat"] == 30.01
