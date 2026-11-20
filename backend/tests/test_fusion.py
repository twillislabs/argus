from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from argus import fusion
from argus.collectors.base import RawIn
from argus.db import utcnow
from argus.fusion import (
    expire_and_prune,
    fuse,
    gdelt_severity,
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
    path="story",
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
            "url": "https://{0}/{1}".format(url, path),
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


def article(ext, title, outlet="Example News", summary=""):
    return RawIn(
        source="rss",
        external_id="https://news.example.com/{0}".format(ext),
        kind="article",
        observed_at=utcnow() - timedelta(minutes=5),
        payload={
            "outlet": outlet,
            "url": "https://news.example.com/{0}".format(ext),
            "title": title,
            "summary": summary,
        },
    )


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

        # A third outlet makes it eligible (3 outlets, 11 articles), but
        # nothing in the news feeds backs it yet.
        await run(db, [gdelt("3", url="c.example.net", articles=4)])
        events = (await db.execute(select(Event))).scalars().all()
        assert len(events) == 1
        event = events[0]
        await db.refresh(event)
        assert event.status == "candidate"
        assert event.data["eligible"]

        # A political headline naming Kharkiv doesn't count; one about an
        # attack does.
        await run(db, [article("p", "Kharkiv mayor opens new library")])
        await db.refresh(event)
        assert event.status == "candidate"
        # The event words must be in the headline, not just the summary.
        await run(
            db,
            [
                article(
                    "r",
                    "Kharkiv budget vote delayed",
                    summary="Officials met after last week's missile attack",
                )
            ],
        )
        await db.refresh(event)
        assert event.status == "candidate"
        # Kharkiv only in the summary, under a headline about somewhere
        # else: not about this event.
        await run(
            db,
            [
                article(
                    "s",
                    "Drone strikes hit refineries in southern Russia",
                    summary="Kharkiv also reported air raid alerts",
                )
            ],
        )
        await db.refresh(event)
        assert event.status == "candidate"
        await run(
            db, [article("q", "Russian missile attack hits Kharkiv overnight")]
        )
        await db.refresh(event)
        assert event.status == "active"
        assert len(event.data["corroboration"]) == 1
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


def test_off_topic_links_dont_count():
    # The Nashville case: legislation and an old court case, coded as
    # violence because they mention the city.
    assert fusion.off_topic(
        "https://www.newschannel5.com/news/politics/legislation-impacting-"
        "data-center-expansion-could-be-a-focus-when-the-legislature-reconvenes"
    )
    assert fusion.off_topic(
        "https://www.local3news.com/local-news/a-decade-later-victim-"
        "testifies-in-new-assault-case-of-woodmore-bus-driver/article_81.html"
    )
    # Court stories about war still count; violence now counts; links
    # with no readable words can't be judged.
    assert not fusion.off_topic("https://x.com/hamas-commander-trial-gaza-war")
    assert not fusion.off_topic("https://x.com/man-shot-dead-downtown")
    assert not fusion.off_topic("https://x.com/protesters-clash-with-police")
    assert not fusion.off_topic("https://www.bbc.com/news/world-12345678")


async def test_off_topic_article_starts_no_event(app):
    async with app.state.db.sessionmaker() as db:
        await run(
            db,
            [
                gdelt(
                    "1",
                    path="city-council-approves-budget-for-new-library",
                    code="190",
                )
            ],
        )
        assert (await db.execute(select(Event))).scalars().all() == []


def test_crime_cluster_reads_the_links():
    crime = [
        "https://a.example/crime/gunman-pleads-guilty-to-shooting-man",
        "https://b.example/news/e-bike-rider-24-killed-philadelphia-hit/",
        "https://c.example/police-officer-injured-alleged-assault",
        "https://d.example/12345",
    ]
    assert fusion.crime_cluster(crime)
    war = crime + [
        "https://e.example/israeli-air-strikes-hit-gaza",
        "https://f.example/troops-advance-near-kharkiv",
    ]
    assert not fusion.crime_cluster(war)
    assert not fusion.crime_cluster(crime[:2])


async def test_crime_gdelt_cluster_is_not_military_force(app):
    paths = [
        "gunman-opens-fire-shooting-man-at-mall",
        "e-bike-rider-killed-in-hit-and-run",
        "police-officer-injured-alleged-assault",
        "man-arrested-over-murder-in-north-london",
    ]
    async with app.state.db.sessionmaker() as db:
        await run(
            db,
            [
                gdelt(
                    str(i),
                    url="{0}.example.com".format("abcd"[i]),
                    articles=8,
                    code="190",
                    path=path,
                )
                for i, path in enumerate(paths)
            ],
        )
        event = (await db.execute(select(Event))).scalar_one()
        assert event.title.startswith("Crime or police incident")
        assert event.data["crime"] is True
        assert event.data["eligible"] is False
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


WHITE_HOUSE = "White House, District of Columbia, United States"


def white_house(ext, code, url, articles=4):
    row = gdelt(ext, lat=38.8951, lon=-77.0364, code=code, url=url)
    row.payload.update(
        {"place": WHITE_HOUSE, "type": "conflict", "articles": articles}
    )
    return row


async def test_political_cluster_is_not_called_fighting(app):
    """GDELT pins US political coverage on the White House. A cluster of
    political stories with a stray "artillery" coding must be labelled by
    what most outlets reported, and need strong backing to go live."""
    async with app.state.db.sessionmaker() as db:
        rows = [
            white_house("w1", "190", "a.example.com"),
            white_house("w2", "190", "b.example.com"),
            white_house("w3", "190", "c.example.com"),
            white_house("w4", "190", "d.example.com"),
            white_house("w5", "194", "e.example.com"),
        ]
        await run(db, rows)
        event = (await db.execute(select(Event))).scalar_one()
        await db.refresh(event)
        assert not event.title.startswith("Artillery")
        # Unconfirmed and only the catch-all code: just "violence".
        assert event.title.startswith("Violence reported in")
        assert event.severity == gdelt_severity("190", "19")

        # Lots of articles from many outlets, still no headline: candidate.
        await run(
            db,
            [
                white_house("w{0}".format(i), "190", "x{0}.example".format(i))
                for i in range(6, 12)
            ],
        )
        await db.refresh(event)
        assert event.data["eligible"]
        assert event.status == "candidate"

        # A headline that only mentions the White House in its summary, or
        # a single outlet, isn't enough for a seat of government.
        await run(
            db,
            [
                article(
                    "s1",
                    "Senate fight over the budget",
                    summary="White House attacks the plan",
                ),
                article("s2", "Drone attack near White House", "One Outlet"),
            ],
        )
        await db.refresh(event)
        assert event.status == "candidate"
        await run(
            db,
            [article("s3", "White House shelter after attack", "Other Wire")],
        )
        await db.refresh(event)
        assert event.status == "active"


async def test_stray_articles_pruned_from_event(app):
    # One real report and one about a parade, fused before the topic
    # check existed: the review takes the parade out and recounts.
    async with app.state.db.sessionmaker() as db:
        await run(
            db,
            [
                gdelt(
                    "1",
                    url="a.example.com",
                    path="missile-strike-hits-kharkiv",
                )
            ],
        )
        event = (await db.execute(select(Event))).scalar_one()
        stray = (
            await store_raw(
                db,
                [
                    gdelt(
                        "2",
                        url="b.example.com",
                        path="mayday-parade-set-for-month-long-return",
                    )
                ],
            )
        )[0]
        db.add(EventSource(event_id=event.id, raw_record_id=stray.id))
        data = dict(event.data)
        data["urls"] = data["urls"] + [stray.payload["url"]]
        data["outlets"] = data["outlets"] + ["b.example.com"]
        event.data = data
        event.source_count, event.article_count = 2, 8
        await db.commit()
        await fusion.review_gdelt(db)
        await db.commit()
        await db.refresh(event)
        assert event.source_count == 1 and event.article_count == 4
        assert all("parade" not in u for u in event.data["urls"])
        links = (
            (
                await db.execute(
                    select(EventSource).where(EventSource.event_id == event.id)
                )
            )
            .scalars()
            .all()
        )
        assert [x.raw_record_id for x in links] != [] and stray.id not in [
            x.raw_record_id for x in links
        ]


async def test_misplaced_event_moves_to_where_links_say(app):
    # Russian strikes on Kyiv, pinned by GDELT on Moscow.
    paths = [
        "russian-strikes-kyiv-bridges-power-outage",
        "russia-attacks-kyiv-with-ballistic-missiles",
        "deadly-attack-on-kyiv-damages-bridges",
        "kyiv-metro-shelters-residents-as-strikes-kill-three",
    ]
    async with app.state.db.sessionmaker() as db:
        await run(
            db,
            [
                gdelt(
                    str(i),
                    lat=55.75,
                    lon=37.62,
                    url="{0}.example.com".format("abcd"[i]),
                    path=p,
                )
                for i, p in enumerate(paths)
            ],
        )
        event = (await db.execute(select(Event))).scalar_one()
        event.place = "Moscow, Moskva, Russia"
        await db.commit()
        await fusion.review_gdelt(db)
        await db.commit()
        await db.refresh(event)
        assert event.place.startswith("Kyiv")
        assert abs(event.lat - 50.45) < 0.2
        assert event.data["moved_from"] == "Moscow, Moskva, Russia"


async def test_misplaced_event_merges_into_one_there(app):
    async with app.state.db.sessionmaker() as db:
        # An event already at Kyiv, and a misplaced one at Moscow.
        await run(
            db,
            [
                gdelt(
                    "k1",
                    lat=50.45,
                    lon=30.52,
                    url="k.example.com",
                    path="kyiv-under-attack-again",
                )
            ],
        )
        await run(
            db,
            [
                gdelt(
                    "m{0}".format(i),
                    lat=55.75,
                    lon=37.62,
                    url="{0}.example.com".format("abc"[i]),
                    path=p,
                )
                for i, p in enumerate(
                    [
                        "russian-missiles-hit-kyiv-overnight",
                        "kyiv-bridges-struck-in-russian-attack",
                        "explosions-rock-kyiv-as-drones-attack",
                    ]
                )
            ],
        )
        events = {
            e.lat > 53: e for e in (await db.execute(select(Event))).scalars()
        }
        moscow, kyiv = events[True], events[False]
        moscow.place = "Moscow, Moskva, Russia"
        await db.commit()
        await fusion.review_gdelt(db)
        await db.commit()
        await db.refresh(moscow)
        await db.refresh(kyiv)
        assert (
            moscow.status == "expired"
            and moscow.data["merged_into"] == kyiv.id
        )
        assert kyiv.source_count == 4


def test_headline_title():
    assert (
        fusion.headline_title(
            "Russian attacks on Kyiv kill 3, cripple bridges - CBC News"
        )
        == "Russian attacks on Kyiv kill 3, cripple bridges"
    )
    assert fusion.headline_title("Plain headline") == "Plain headline"
