from sqlalchemy import select

from argus import fusion, story
from argus.models import Event
from tests.test_fusion import gdelt, run


def test_stem_and_terms():
    assert story.stem("strikes") == story.stem("striking") == "strik"
    assert story.stem("russian") == story.stem("russia")
    assert story.link_terms(
        "https://x.example/news/2026/11/20/russian-strikes-hit-kyiv-bridges"
    ) == {"russia", "strik", "hit", "kyiv", "bridg"}
    assert not story.readable(story.link_terms("https://x.example/a/12345"))


def test_rare_words_decide_the_story():
    docs = [
        "russia-strikes-kyiv-dnipro-bridges",
        "kyiv-dnipro-bridges-hit-by-russian-strikes",
        "russian-missile-crashes-in-poland-provocation",
        "russia-strikes-ukraine-energy-grid",
        "russian-strikes-ukraine-again",
        "russia-strikes-odesa-port",
    ]
    terms = [story.link_terms("https://x.example/" + d) for d in docs]
    w = story.Weights(terms)
    groups = story.clusters(terms, w)
    # The bridges story holds together; Poland is its own story.
    assert [0, 1] in groups
    assert [2] in groups
    assert w.similarity(terms[0], terms[1]) > w.similarity(terms[0], terms[3])


async def test_event_keeps_its_main_story(app):
    async with app.state.db.sessionmaker() as db:
        main = [
            "police-clash-with-protesters-at-youth-strike-rally",
            "youth-strike-rally-protesters-clash-with-police",
            "protesters-arrested-at-youth-strike-rally",
        ]
        other = [
            "army-commander-warns-britain-not-at-peace",
            "ebola-response-hampered-by-violence-in-congo",
        ]
        await run(
            db,
            [
                gdelt(
                    "r{0}".format(i),
                    lat=51.5,
                    lon=-0.12,
                    url="{0}.example.com".format("abcde"[i]),
                    path=p,
                )
                for i, p in enumerate(main + other)
            ],
        )
        events = list((await db.execute(select(Event))).scalars())
        # New records already file by story.
        assert len(events) == 3
        big = max(events, key=lambda e: e.source_count)
        assert big.source_count == 3
        assert all("youth" in u for u in big.data["urls"])


async def test_split_moves_other_stories_out(app):
    async with app.state.db.sessionmaker() as db:
        paths = [
            "police-clash-with-protesters-at-youth-strike-rally",
            "youth-strike-rally-protesters-clash-with-police",
            "protesters-arrested-at-youth-strike-rally",
            "army-commander-warns-britain-not-at-peace",
        ]
        # Fused before story matching: one event holding both stories.
        saved = fusion.pick_cluster
        fusion.pick_cluster = lambda row, c: c[0] if c else None
        try:
            await run(
                db,
                [
                    gdelt(
                        "s{0}".format(i),
                        lat=51.5,
                        lon=-0.12,
                        url="{0}.example.com".format("abcd"[i]),
                        path=p,
                    )
                    for i, p in enumerate(paths)
                ],
            )
        finally:
            fusion.pick_cluster = saved
        assert len(list((await db.execute(select(Event))).scalars())) == 1
        await fusion.review_gdelt(db)
        await db.commit()
        events = list(
            (
                await db.execute(
                    select(Event).where(Event.status != "expired")
                )
            ).scalars()
        )
        assert sorted(e.source_count for e in events) == [1, 3]
        lone = min(events, key=lambda e: e.source_count)
        assert "army-commander" in lone.data["urls"][0]


async def test_article_belongs_to_one_event(app):
    async with app.state.db.sessionmaker() as db:
        url = "russia-strikes-kyiv-dnipro-bridges"
        # GDELT files the same article under Kyiv and Moscow.
        await run(
            db,
            [
                gdelt(
                    "k", lat=50.45, lon=30.52, url="a.example.com", path=url
                ),
                gdelt(
                    "m", lat=55.75, lon=37.62, url="a.example.com", path=url
                ),
            ],
        )
        events = {
            e.lat > 53: e for e in (await db.execute(select(Event))).scalars()
        }
        events[False].place = "Kyiv, Ukraine"
        events[True].place = "Moscow, Russia"
        await db.commit()
        await fusion.review_gdelt(db)
        await db.commit()
        await db.refresh(events[True])
        await db.refresh(events[False])
        assert events[True].status == "expired"
        assert events[False].status != "expired"


async def test_same_story_elsewhere_merges(app):
    async with app.state.db.sessionmaker() as db:
        # Kyiv's own story, and the same story pinned on Moscow by links
        # that never name Moscow.
        await run(
            db,
            [
                gdelt(
                    "k{0}".format(i),
                    lat=50.45,
                    lon=30.52,
                    url="k{0}.example.com".format(i),
                    path=p,
                )
                for i, p in enumerate(
                    [
                        "russian-strikes-damage-kyiv-dnipro-bridges",
                        "kyiv-dnipro-bridges-damaged-in-russian-strikes",
                    ]
                )
            ],
        )
        await run(
            db,
            [
                gdelt(
                    "m1",
                    lat=55.75,
                    lon=37.62,
                    url="m.example.com",
                    path="russian-strikes-damage-kyiv-dnipro-bridges",
                ),
                # Same words, but its links name Warsaw, not Kyiv: a
                # story of its own.
                gdelt(
                    "w1",
                    lat=52.23,
                    lon=21.01,
                    url="w.example.com",
                    path="russian-strikes-damage-warsaw-dnipro-bridges",
                ),
            ],
        )
        by_lat = {
            round(e.lat): e
            for e in (await db.execute(select(Event))).scalars()
        }
        kyiv, moscow, warsaw = by_lat[50], by_lat[56], by_lat[52]
        kyiv.place = "Kyiv, Ukraine"
        moscow.place = "Moscow, Russia"
        warsaw.place = "Warsaw, Poland"
        await db.commit()
        await fusion.review_gdelt(db)
        await db.commit()
        for e in (kyiv, moscow, warsaw):
            await db.refresh(e)
        assert moscow.data.get("merged_into") == kyiv.id
        assert warsaw.status != "expired"
