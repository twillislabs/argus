from pathlib import Path

from argus import faa

XML = (Path(__file__).parent / "fixtures" / "faa_status.xml").read_bytes()


def test_parse_status():
    s = faa.parse_status(XML)
    a = s["airports"]
    assert s["updated"].startswith("Thu Nov 19")
    assert a["JFK"] == [
        {
            "kind": "ground_stop",
            "reason": "thunderstorms",
            "end_time": "3:30 pm EST",
        }
    ]
    sfo = a["SFO"][0]
    assert sfo["kind"] == "ground_delay"
    assert sfo["avg"] == "1 hour and 20 minutes"
    mco = a["MCO"][0]
    assert mco["kind"] == "delay" and mco["direction"] == "Departure"
    assert mco["min"] == "16 minutes" and mco["trend"] == "Increasing"
    # Closed to unscheduled GA only: a partial notice, not a closure.
    assert a["LAX"][0]["kind"] == "closure" and a["LAX"][0]["partial"]
    assert a["SNA"][0]["partial"] is False
    # Las Vegas has a ground delay and a closure notice.
    assert [i["kind"] for i in a["LAS"]] == ["ground_delay", "closure"]


async def test_status_endpoint(admin_client, app):
    class Fake:
        async def get(self):
            return faa.parse_status(XML) | {"status": "ok"}

        async def close(self):
            return None

    app.state.faa = Fake()
    body = (await admin_client.get("/api/airports/status")).json()
    assert body["status"] == "ok" and "SFO" in body["airports"]


async def test_status_needs_sign_in(client):
    assert (await client.get("/api/airports/status")).status_code == 401
