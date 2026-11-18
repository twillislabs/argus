from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from argus.collectors.base import RawIn
from argus.db import utcnow
from argus.fusion import (
    expire_and_prune,
    fuse,
    quake_severity,
    store_raw,
)
from argus.models import Article, Event, EventSource


def quake(ext="us1", mag=6.2, **payload):
    p = {
        "mag": mag,
        "mag_type": "mww",
        "depth_km": 10,
        "place": "12 km SW of Ishinomaki, Japan",
        "title": "M {0} - 12 km SW of Ishinomaki, Japan".format(mag),
        "url": "https://earthquake.usgs.gov/x",
        "alert": None,
        "tsunami": 0,
        "status": "reviewed",
    }
    p.update(payload)
    return RawIn(
        source="usgs",
        external_id=ext,
        kind="quake",
        observed_at=utcnow() - timedelta(minutes=5),
        lat=38.3,
        lon=141.2,
        payload=p,
    )


def gdelt(
    ext,
    lat=49.98,
    lon=36.25,
    articles=4,
    url="a.example.com",
    code="194",
    root=True,
):
    return RawIn(
        source="gdelt",
        external_id=ext,
        kind="gdelt",
        observed_at=utcnow() - timedelta(minutes=10),
        lat=lat,
        lon=lon,
        payload={
            "type": "conflict",
            "root": code[:2],
            "code": code,
            "label": "Artillery and tank fighting",
            "actor1": "MILITARY",
            "actor2": "",
            "articles": articles,
            "root_event": root,
            "place": "Kharkiv, Kharkivs'ka Oblast', Ukraine",
            "url": "https://{0}/story".format(url),
        },
    )


async def run(db, records):
    rows = await store_raw(db, records)
    changed = await fuse(db, rows)
    await db.commit()
    return changed


def test_quake_severity():
    assert quake_severity({"mag": 4.0}) == 1
    assert quake_severity({"mag": 6.1}) == 3
    assert quake_severity({"mag": 8.1}) == 5
    assert quake_severity({"mag": 5.0, "alert": "orange"}) == 4
    assert quake_severity({"mag": 5.0, "tsunami": 1}) == 3


async def test_quake_upsert_and_revision(app):
    async with app.state.db.sessionmaker() as db:
        changed = await run(db, [quake()])
        assert len(changed) == 1
        event = (await db.execute(select(Event))).scalar_one()
        assert event.type == "quake"
        assert event.status == "active"
        assert event.severity == 3
        assert event.country == "Japan"

        # Same record again: nothing changes.
        assert await run(db, [quake()]) == set()
        # USGS revises the magnitude: the same event is updated.
        changed = await run(db, [quake(mag=7.1)])
        assert changed == {event.id}
        await db.refresh(event)
        assert event.severity == 4
        events = (await db.execute(select(Event))).scalars().all()
        assert len(events) == 1


async def test_gdelt_cluster_and_promotion(app):
    async with app.state.db.sessionmaker() as db:
        # One outlet, few articles: a candidate only.
        await run(db, [gdelt("1", url="a.example.com", articles=3)])
        event = (await db.execute(select(Event))).scalar_one()
        assert event.status == "candidate"
        assert event.title.startswith("Artillery and tank fighting reported")

        # A second outlet about 5 km away joins the same cluster, but two
        # outlets and 7 articles are still below the bar.
        await run(
            db,
            [
                gdelt(
                    "2", lat=50.02, lon=36.28, url="b.example.org", articles=4
                )
            ],
        )
        event = (await db.execute(select(Event))).scalar_one()
        assert event.status == "candidate"

        # A third outlet pushes it over: 3 outlets, 11 articles.
        await run(db, [gdelt("3", url="c.example.net", articles=4)])
        events = (await db.execute(select(Event))).scalars().all()
        assert len(events) == 1
        event = events[0]
        await db.refresh(event)
        assert event.status == "active"
        assert event.source_count == 3
        assert event.article_count == 11
        assert event.place == "Kharkiv, Ukraine"
        links = (await db.execute(select(EventSource))).scalars().all()
        assert len(links) == 3

        # Far away (Kyiv): a separate cluster.
        await run(db, [gdelt("4", lat=50.45, lon=30.52)])
        assert len((await db.execute(select(Event))).scalars().all()) == 2


async def test_generic_gdelt_code_needs_more(app):
    async with app.state.db.sessionmaker() as db:
        await run(
            db,
            [
                gdelt("1", url="a.example.com", articles=6, code="190"),
                gdelt("2", url="b.example.com", articles=6, code="193"),
                gdelt("3", url="c.example.com", articles=6, code="190"),
            ],
        )
        event = (await db.execute(select(Event))).scalar_one()
        assert event.status == "candidate"


async def test_articles_stored_once(app):
    rec = RawIn(
        source="rss",
        external_id="https://example.com/a",
        kind="article",
        observed_at=utcnow(),
        payload={
            "outlet": "Example",
            "url": "https://example.com/a",
            "title": "Quake in Japan",
            "summary": "",
        },
    )
    async with app.state.db.sessionmaker() as db:
        await run(db, [rec])
        await run(db, [rec])
        assert len((await db.execute(select(Article))).scalars().all()) == 1


async def test_expire(app):
    async with app.state.db.sessionmaker() as db:
        await run(db, [quake()])
        event = (await db.execute(select(Event))).scalar_one()
        event.last_updated = datetime.now(UTC) - timedelta(days=4)
        await db.commit()
        assert await expire_and_prune(db, 30, 30) == 1
        await db.commit()
        await db.refresh(event)
        assert event.status == "expired"


async def test_non_root_gdelt_ignored(app):
    async with app.state.db.sessionmaker() as db:
        assert await run(db, [gdelt("9", root=False)]) == set()
        assert (await db.execute(select(Event))).scalars().all() == []


def test_tidy_place():
    from argus.fusion import tidy_gdelt_place

    assert tidy_gdelt_place("Kyiv, Kyyiv, Misto, Ukraine") == "Kyiv, Ukraine"
    assert tidy_gdelt_place("Gaza, Israel (general), Israel") == "Gaza, Israel"
    assert (
        tidy_gdelt_place("Chicago, Illinois, United States")
        == "Chicago, Illinois"
    )
