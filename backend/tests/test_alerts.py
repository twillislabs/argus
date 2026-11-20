import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx

from argus import alerts
from argus.aviation import LiveAir
from argus.db import utcnow
from argus.models import AlertChannel, Event
from argus.sea import LiveSea
from tests.conftest import csrf
from tests.test_users import create, sign_in


def test_areas():
    circle = {"center": [-86.78, 36.16], "radius_km": 50}
    assert alerts.in_area(circle, 36.3, -86.7)
    assert not alerts.in_area(circle, 37.5, -86.7)
    ring = {"ring": [[0, 0], [10, 0], [10, 10], [0, 10]]}
    assert alerts.in_area(ring, 5, 5) and not alerts.in_area(ring, 11, 5)
    assert alerts.in_area(None, None, None)


def test_url_allowed():
    assert alerts.url_allowed("https://ntfy.sh")
    assert alerts.url_allowed("http://192.168.1.5:8123/api/webhook/x")
    for bad in (
        "ftp://x",
        "http://localhost/x",
        "http://127.0.0.1/x",
        "http://169.254.169.254/latest",
        "http://db:5432",
        "http://api:8000/api/admin",
    ):
        assert not alerts.url_allowed(bad), bad


def test_quiet_hours_wrap_midnight():
    ch = SimpleNamespace(quiet_from="22:00", quiet_to="07:00", tz="UTC")
    assert alerts.in_quiet(ch, datetime(2026, 11, 20, 23, 30, tzinfo=UTC))
    assert alerts.in_quiet(ch, datetime(2026, 11, 20, 6, 59, tzinfo=UTC))
    assert not alerts.in_quiet(ch, datetime(2026, 11, 20, 12, 0, tzinfo=UTC))


def fake_state():
    async def none():
        return {}

    return SimpleNamespace(
        air=LiveAir(),
        sea=LiveSea(),
        raids=SimpleNamespace(get=none),
        faa=SimpleNamespace(get=none),
        spaceweather=SimpleNamespace(get=none),
    )


async def test_rule_fires_once_and_pushes(admin_client, app):
    r = await admin_client.post(
        "/api/alert-rules",
        json={
            "name": "Near home",
            "kind": "events",
            "params": {
                "area": {"center": [-86.78, 36.16], "radius_km": 100},
                "min_severity": 4,
            },
        },
        headers=csrf(admin_client),
    )
    assert r.status_code == 201, r.text
    r = await admin_client.put(
        "/api/alerts/channels",
        json={
            "ntfy_topic": "argus-secret-topic-123",
            "base_url": "https://argus.example.org",
            "webhook_url": "https://hooks.example.org/abcdef123456",
            "webhook_format": "discord",
        },
        headers=csrf(admin_client),
    )
    body = r.json()
    assert body["ntfy_topic_hint"] == "…-123"
    assert "secret-topic" not in json.dumps(body)
    assert "abcdef12" not in json.dumps(body)

    async with app.state.db.sessionmaker() as db:
        now = utcnow()
        for eid, lat, sev in (
            ("e1", 36.2, 4),
            ("far", 40.0, 5),
            ("low", 36.2, 2),
        ):
            db.add(
                Event(
                    id=eid,
                    type="hazard",
                    severity=sev,
                    status="active",
                    title="Tornado warning event {0}".format(eid),
                    place="Nashville",
                    country="United States",
                    lat=lat,
                    lon=-86.8,
                    first_seen=now + timedelta(seconds=1),
                    last_updated=now + timedelta(seconds=1),
                    confidence=0.9,
                    source_count=1,
                    article_count=0,
                    data={},
                )
            )
        await db.commit()

    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append((str(request.url), json.loads(request.content)))
        return httpx.Response(200, json={})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    state = fake_state()
    key = app.state.settings.secret_key
    fired = await alerts.run_once(
        app.state.db.sessionmaker, state, key, client
    )
    again = await alerts.run_once(
        app.state.db.sessionmaker, state, key, client
    )
    await client.aclose()
    assert (fired, again) == (1, 0)
    urls = [u for u, _ in sent]
    assert urls == [
        "https://ntfy.sh",
        "https://hooks.example.org/abcdef123456",
    ]
    ntfy = sent[0][1]
    assert ntfy["topic"] == "argus-secret-topic-123"
    assert ntfy["click"] == "https://argus.example.org/#e=e1"
    assert ntfy["priority"] == 4
    assert "Tornado warning event e1" in sent[1][1]["content"]

    bell = (await admin_client.get("/api/alerts")).json()
    assert bell["unread"] == 1
    assert bell["alerts"][0]["pushed"] == "ntfy: sent; webhook: sent"
    await admin_client.post(
        "/api/alerts/read", json={"all": True}, headers=csrf(admin_client)
    )
    assert (await admin_client.get("/api/alerts")).json()["unread"] == 0


async def test_quiet_hours_hold_pushes(admin_client, app):
    await admin_client.post(
        "/api/alert-rules",
        json={"name": "Storms", "kind": "space", "params": {"g_min": 1}},
        headers=csrf(admin_client),
    )
    async with app.state.db.sessionmaker() as db:
        db.add(
            AlertChannel(
                user_id=1,
                quiet_from="00:00",
                quiet_to="23:59",
                tz="UTC",
                webhook_format="json",
            )
        )
        await db.commit()

    async def storm():
        return {
            "now": {"G": {"scale": 2, "text": "moderate"}},
            "kp": {"now": 6},
        }

    state = fake_state()
    state.spaceweather = SimpleNamespace(get=storm)

    def handler(request):  # nothing should be sent
        raise AssertionError("pushed during quiet hours")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    n = await alerts.run_once(
        app.state.db.sessionmaker, state, app.state.settings.secret_key, client
    )
    await client.aclose()
    assert n == 1
    bell = (await admin_client.get("/api/alerts")).json()
    assert bell["alerts"][0]["title"] == "Geomagnetic storm G2"
    assert bell["alerts"][0]["pushed"] == "quiet"


async def test_validation_and_permissions(admin_client, app):
    bad = await admin_client.post(
        "/api/alert-rules",
        json={
            "name": "x",
            "kind": "airport",
            "params": {"codes": ["not a code"]},
        },
        headers=csrf(admin_client),
    )
    assert bad.status_code == 422
    hook = await admin_client.put(
        "/api/alerts/channels",
        json={"webhook_url": "http://127.0.0.1:8000/api/admin/users"},
        headers=csrf(admin_client),
    )
    assert hook.status_code == 422
    r = await create(
        admin_client, username="vee", display_name="Vee", role="viewer"
    )
    temp = r.json()["temporary_password"]
    c, _ = await sign_in(app, "vee", temp)
    await c.post(
        "/api/me/password",
        json={
            "current_password": temp,
            "new_password": "a long new passphrase",
        },
        headers=csrf(c),
    )
    assert (await c.get("/api/alert-rules")).status_code == 403
    await c.aclose()
