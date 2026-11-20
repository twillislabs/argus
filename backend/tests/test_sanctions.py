from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx

from argus import alerts, sanctions
from argus.db import utcnow
from argus.models import ServerSetting
from argus.sea import LiveSea
from tests.conftest import csrf

CSV = (
    Path(__file__).parent / "fixtures" / "sanctions_maritime.csv"
).read_text()


def test_parse_vessels_only():
    data = sanctions.parse(CSV)
    # Organisations are left out; ships keyed by IMO and MMSI.
    assert data["count"] == 5
    assert "9650016" in data["imo"] and "677099900" in data["mmsi"]
    assert "0004034" not in data["imo"]


def test_match_and_flags():
    index = sanctions.SanctionsIndex()
    index.data = sanctions.parse(CSV)
    hit = index.match(imo=9650016)
    assert hit[0]["name"] == "RN Sakhalin"
    assert hit[0]["labels"] == ["Sanctioned"]
    assert hit[0]["url"].startswith("https://www.opensanctions.org/entities/")
    # MMSI alone, and both at once without repeats.
    assert index.flags(mmsi=677099900) == ["mare.shadow", "poi"]
    assert len(index.match(mmsi=677099900, imo=1031537)) == 1
    # Detentions show in the panel but aren't a serious flag.
    assert index.flags(imo=9427366) == []
    assert index.match(imo=9427366)[0]["labels"][0].startswith("Detained")
    assert index.match(mmsi=123456789) == []


async def test_vessels_api_flags_listed_ships(admin_client, app):
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:sanctions",
                value={"fetched": "t1", "list": sanctions.parse(CSV)},
            )
        )
        await db.commit()
    app.state.sea.apply(
        [
            {"mmsi": 677099900, "lat": 26.5, "lon": 56.3, "pos_at": 1e10},
            {"mmsi": 211000001, "lat": 26.6, "lon": 56.4, "pos_at": 1e10},
        ]
    )
    body = (await admin_client.get("/api/vessels?bbox=55,25,57,27")).json()
    flagged = {v["mmsi"]: v.get("sanctions") for v in body["vessels"]}
    assert flagged == {677099900: ["mare.shadow", "poi"], 211000001: None}
    one = (await admin_client.get("/api/vessels/677099900")).json()
    assert one["sanctions_listings"][0]["name"] == "LADY JASMINE"
    assert "OpenSanctions" in one["sanctions_attribution"]


async def test_sanctions_alert_rule(admin_client, app):
    r = await admin_client.post(
        "/api/alert-rules",
        json={"name": "Shadow fleet", "kind": "sanctions", "params": {}},
        headers=csrf(admin_client),
    )
    assert r.status_code == 201, r.text
    index = sanctions.SanctionsIndex()
    index.data = sanctions.parse(CSV)
    index.checked = 1e18  # no reload from the database
    sea = LiveSea()
    sea.apply(
        [{"mmsi": 677099900, "name": "LADY JASMINE", "lat": 26.5, "lon": 56.3}]
    )

    async def none():
        return {}

    state = SimpleNamespace(
        sea=sea,
        sanctions=index,
        raids=SimpleNamespace(get=none),
        faa=SimpleNamespace(get=none),
        spaceweather=SimpleNamespace(get=none),
    )
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200))
    )
    n = await alerts.run_once(
        app.state.db.sessionmaker,
        state,
        app.state.settings.secret_key,
        client,
        now=utcnow() + timedelta(seconds=1),
    )
    await client.aclose()
    assert n == 1
    bell = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    assert bell["title"] == "LADY JASMINE in view: Shadow fleet"
