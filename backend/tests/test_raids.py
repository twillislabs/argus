import json
from datetime import UTC, datetime
from pathlib import Path

from argus import raids

FIX = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


def test_ukraine_oblasts():
    now = datetime(2026, 11, 20, 15, 0, tzinfo=UTC)
    out = raids.parse_ukraine(load("raids_ukraine.json"), now)
    assert len(out) == 26
    kharkiv = next(r for r in out if r["name"] == "Kharkiv Oblast")
    assert kharkiv["active"] and not kharkiv["long_running"]
    # 16:25:29 Kyiv time (UTC+2 in November) is 14:25:29 UTC.
    assert kharkiv["since"].startswith("2026-11-20T14:25:29")
    luhansk = next(r for r in out if r["name"] == "Luhansk Oblast")
    assert luhansk["active"] and luhansk["long_running"]
    # Active ones first, continuous ones after the fresh ones.
    assert out[0]["active"] and not out[0]["long_running"]
    assert not out[-1]["active"]


def test_israel_recent_and_active():
    places = raids.parse_places(load("raids_israel_places.json"))
    history = load("raids_israel_history.json")
    newest = max(a["time"] for g in history for a in g["alerts"])
    now_doc = [
        {
            "time": newest + 60,
            "cities": [next(iter(places))],
            "threat": 5,
            "isDrill": False,
        }
    ]
    out = raids.parse_israel(now_doc, history, places, now=newest + 120)
    assert out[0]["active"] and out[0]["threat_label"] == "Hostile aircraft"
    assert all(r["name"] and r["lat"] for r in out)
    assert {r["threat_label"] for r in out} >= {"Rockets and missiles"}
    # Older than a day: gone. Drills never show.
    assert raids.parse_israel([], history, places, now=newest + 90000) == []
    drill = [{"time": newest, "cities": [next(iter(places))], "isDrill": True}]
    assert raids.parse_israel(drill, [], places, now=newest) == []


async def test_raids_endpoint(admin_client, app):
    class Fake:
        async def get(self):
            return {"ukraine": [], "israel": []}

        async def close(self):
            return None

    app.state.raids = Fake()
    body = (await admin_client.get("/api/raids")).json()
    assert body == {"ukraine": [], "israel": []}
