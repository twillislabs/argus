from datetime import timedelta

from starlette.testclient import TestClient

from argus.collectors.base import RawIn
from argus.db import utcnow
from argus.fusion import fuse, store_raw
from tests.conftest import setup_body
from tests.test_fusion import quake


async def seed(app):
    article = RawIn(
        source="rss",
        external_id="https://example.com/q",
        kind="article",
        observed_at=utcnow() - timedelta(minutes=2),
        payload={
            "outlet": "Example News",
            "url": "https://example.com/q",
            "title": "Strong quake rattles Ishinomaki",
            "summary": "Buildings shook in northern Japan.",
        },
    )
    async with app.state.db.sessionmaker() as db:
        rows = await store_raw(db, [quake(), quake("us2", mag=4.6), article])
        await fuse(db, rows)
        await db.commit()


async def test_events_require_sign_in(client):
    for path in ("/api/events", "/api/summary", "/api/sources", "/api/news"):
        assert (await client.get(path)).status_code == 401, path


async def test_list_filter_and_detail(admin_client, app):
    await seed(app)
    events = (await admin_client.get("/api/events")).json()["events"]
    assert len(events) == 2
    assert events[0]["severity"] >= events[1]["severity"]

    strong = await admin_client.get("/api/events?min_severity=3")
    assert len(strong.json()["events"]) == 1

    none = await admin_client.get("/api/events?bbox=-10,-10,10,10")
    assert none.json()["events"] == []
    japan = await admin_client.get("/api/events?bbox=130,30,150,45")
    assert len(japan.json()["events"]) == 2

    bad = await admin_client.get("/api/events?bbox=1,2,3")
    assert bad.status_code == 422

    detail = await admin_client.get("/api/events/{0}".format(events[0]["id"]))
    body = detail.json()
    assert body["sources"][0]["source"] == "usgs"
    assert body["articles"][0]["outlet"] == "Example News"

    assert (await admin_client.get("/api/events/NOPE")).status_code == 404


async def test_summary_and_news(admin_client, app):
    await seed(app)
    s = (await admin_client.get("/api/summary")).json()
    assert s["total"] == 2
    assert s["by_type"] == {"quake": 2}
    assert s["news"][0]["title"].startswith("Strong quake")
    news = (await admin_client.get("/api/news?q=Ishinomaki")).json()
    assert len(news["articles"]) == 1


async def test_places_public_search(client):
    r = await client.get("/api/places?q=Goodlettsville")
    top = r.json()["places"][0]
    assert top["name"] == "Goodlettsville"
    assert top["region"] == "Tennessee"
    assert top["tz"] == "America/Chicago"
    r = await client.get("/api/places?q=springfield, IL")
    assert r.json()["places"][0]["region"] == "Illinois"
    r = await client.get("/api/places?q=sao paulo")
    assert r.json()["places"][0]["name"] == "São Paulo"


def test_live_socket(settings, tmp_path):
    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    from argus.db import Base
    from argus.main import create_app

    async def make_tables():
        engine = create_async_engine(settings.database_url)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(make_tables())
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as tc:
        # Not signed in: refused.
        try:
            with tc.websocket_connect("/ws/live") as ws:
                ws.receive_text()
            refused = False
        except Exception:
            refused = True
        assert refused
        assert tc.post("/api/setup", json=setup_body()).status_code == 201
        # Cross-site origin: refused.
        try:
            with tc.websocket_connect(
                "/ws/live", headers={"origin": "https://evil.example"}
            ) as ws:
                ws.receive_text()
            refused = False
        except Exception:
            refused = True
        assert refused
        with tc.websocket_connect(
            "/ws/live", headers={"origin": "http://testserver"}
        ) as ws:
            assert ws.receive_json() == {"type": "hello"}
            tc.portal.call(app.state.hub.broadcast, '{"type":"events"}')
            assert ws.receive_json() == {"type": "events"}


async def test_nearest_place(client):
    r = await client.get("/api/places/nearest?lat=36.32&lon=-86.71")
    assert r.json()["place"]["name"] == "Goodlettsville"
    r = await client.get("/api/places/nearest?lat=0&lon=-140")
    assert r.json()["place"] is None
