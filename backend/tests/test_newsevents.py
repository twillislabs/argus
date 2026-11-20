from datetime import timedelta

from sqlalchemy import select

from argus import newsevents
from argus.db import utcnow
from argus.models import Article, Event


def add(db, outlet, title, minutes=30):
    now = utcnow()
    db.add(
        Article(
            outlet=outlet,
            url="https://{0}.example/{1}".format(
                outlet.lower().replace(" ", ""), abs(hash(title))
            ),
            title=title,
            summary="",
            published_at=now - timedelta(minutes=minutes),
            fetched_at=now,
        )
    )


def test_place_and_newsworthy():
    assert newsevents.place_named("Train derails in East Palestine, Ohio")[
        1
    ] == ("Ohio, United States")
    assert newsevents.place_named("Shooting in Nashville leaves 3 dead")[
        1
    ].startswith("Nashville, Tennessee")
    # Washington is the government, Birmingham is in England too.
    assert newsevents.place_named("Washington weighs new sanctions") is None
    assert newsevents.place_named("Birmingham bin strike goes on") is None
    assert newsevents.place_named(
        "Six killed in gas explosion at Georgia apartment building"
    )[1] == ("Georgia, United States")
    assert (
        newsevents.place_named("Georgian protesters rally in Tbilisi, Georgia")
        is None
    )
    assert newsevents.place_named(
        "White House fires cyber chief after wave of US outages"
    )[1] == ("Nationwide, United States")
    assert newsevents.newsworthy("Train derails in Ohio, forcing evacuations")
    assert not newsevents.newsworthy("Ohio governor signs budget bill")
    assert not newsevents.newsworthy("Why Ohio derailments keep happening")


async def test_headlines_make_an_event(app):
    async with app.state.db.sessionmaker() as db:
        add(db, "CBS News", "Train carrying chemicals derails in Ohio")
        add(db, "Fox News", "Ohio train derailment forces evacuations")
        add(db, "ABC News", "Chemical train derails in Ohio, homes evacuated")
        # Only two outlets: not enough.
        add(db, "CBS News", "Bridge collapses in Pittsburgh after storm")
        add(db, "Fox News", "Pittsburgh bridge collapse injures commuters")
        # Politics, not an event.
        add(db, "NPR", "Ohio senate passes rail safety bill")
        add(db, "CBS News", "Ohio lawmakers pass rail safety bill")
        add(db, "Fox News", "Rail safety bill passes Ohio senate")
        await db.commit()
        changed = await newsevents.review(db)
        await db.commit()
        events = list((await db.execute(select(Event))).scalars())
        assert len(events) == 1 and events[0].id in changed
        e = events[0]
        assert e.type == "incident" and e.status == "active"
        assert e.place == "Ohio, United States"
        assert e.source_count == 3 and "derail" in e.title.lower()
        assert e.key.startswith("news:")
        # A fourth headline updates the same event.
        add(
            db,
            "NBC News",
            "Ohio derailment: chemical train evacuations widen",
            5,
        )
        await db.commit()
        await newsevents.review(db)
        await db.commit()
        events = list((await db.execute(select(Event))).scalars())
        assert len(events) == 1 and events[0].source_count == 4


async def test_quake_headlines_left_to_usgs(app):
    async with app.state.db.sessionmaker() as db:
        now = utcnow()
        db.add(
            Event(
                id="QUAKE000001",
                key="usgs:1",
                type="quake",
                severity=2,
                status="active",
                title="M 4.4 - 5 km N of Los Angeles",
                summary="",
                place="Los Angeles, California, United States",
                country="United States",
                lat=34.1,
                lon=-118.2,
                first_seen=now,
                last_updated=now,
                confidence=0.99,
                source_count=1,
                article_count=0,
                data={},
            )
        )
        add(db, "CBS News", "4.4-magnitude earthquake rattles Los Angeles")
        add(db, "Breitbart", "Los Angeles rocked by magnitude 4.4 earthquake")
        add(db, "NY Post", "Earthquake shakes Los Angeles awake, 4.4 quake")
        await db.commit()
        assert await newsevents.review(db) == set()


async def test_top_stories_split_us_and_world(app, admin_client):
    from tests.test_auth import csrf

    async with app.state.db.sessionmaker() as db:
        for outlet in ("Fox News", "CBS News", "NBC News"):
            add(db, outlet, "Senate Democrats win Alaska race after recount")
        for outlet in ("BBC News", "Al Jazeera"):
            add(db, outlet, "UK and EU summit seeks to mend Brexit ties")
        add(db, "Fox News", "A story only one outlet ran about lobsters")
        await db.commit()
    body = (await admin_client.get("/api/stories")).json()
    assert [s["outlet_count"] for s in body["us"]] == [3]
    assert "Alaska" in body["us"][0]["title"]
    assert [s["outlet_count"] for s in body["world"]] == [2]
    # The Brief's order is a preference; unknown sections are dropped.
    response = await admin_client.patch(
        "/api/me/preferences",
        json={"brief": {"order": ["world_stories", "nope"], "hidden": []}},
        headers=csrf(admin_client),
    )
    assert response.json()["preferences"]["brief"]["order"] == [
        "world_stories"
    ]
