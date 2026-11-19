from datetime import timedelta
from types import SimpleNamespace

from argus import tension
from argus.db import utcnow
from argus.models import Event, TensionDaily


def ev(
    kind="conflict",
    country="Ukraine",
    hours=0.0,
    severity=3,
    confidence=1.0,
    status="active",
    lat=49.0,
    lon=32.0,
    now=None,
):
    now = now or utcnow()
    return SimpleNamespace(
        id="E{0}{1}".format(country[:3], hours),
        title="{0} in {1}".format(kind, country),
        type=kind,
        country=country,
        severity=severity,
        confidence=confidence,
        status=status,
        lat=lat,
        lon=lon,
        last_updated=now - timedelta(hours=hours),
    )


def test_weight_halves_every_twelve_hours():
    now = utcnow()
    fresh = tension.weight(ev(now=now), now)
    old = tension.weight(ev(hours=12, now=now), now)
    assert fresh == 3.0
    assert abs(old - 1.5) < 1e-9
    # Unconfirmed reports and quakes don't count.
    assert tension.weight(ev(status="candidate", now=now), now) == 0.0
    assert tension.weight(ev(kind="quake", now=now), now) == 0.0


def test_raw_scores_roll_up():
    now = utcnow()
    scores = tension.raw_scores(
        [
            ev(now=now),
            ev(country="Gaza Strip", lat=31.5, lon=34.4, now=now),
            ev(kind="maritime", country="", lat=14.0, lon=42.0, now=now),
            ev(country="United States", lat=38.9, lon=-77.0, now=now),
        ],
        now,
    )
    assert scores["Ukraine"] == 3.0
    assert scores["Palestine"] == 3.0  # alias
    assert scores["theatre:eastern-europe"] == 3.0
    # Gaza plus the Red Sea warning (no country, placed by its box).
    assert abs(scores["theatre:middle-east"] - 3.0 - 2.4) < 1e-9
    assert scores["theatre:americas"] == 3.0
    assert abs(scores["world"] - 11.4) < 1e-9


def test_standing_and_live_points():
    # Log scale on UCDP deaths a year: 50,000+ is 100.
    assert tension.standing(0) == 0
    assert round(tension.standing(1000)) == 64
    assert tension.standing(200_000) == 100
    # Live activity adds at most 20 points.
    assert tension.live_points(0) == 0
    assert tension.live_points(1000) == 20
    assert tension.level(64.0, 1.0) == 72
    assert tension.level(95.0, 50.0) == 100
    assert tension.band(39) == "calm"
    assert tension.band(40) == "stable"
    assert tension.band(55) == "moderate"
    assert tension.band(68) == "high"
    assert tension.band(78) == "extreme"
    assert tension.vs_normal(4.0, 2.0) == 100
    assert tension.vs_normal(4.0, None) is None


def test_bundled_ucdp_data():
    data, through = tension.conflict_data()
    assert through[:4].isdigit()
    # The big wars of the period score at the top.
    assert tension.standing(data["Ukraine"]["deaths_12m"]) >= 95
    assert "Palestine" in data


async def test_samples_and_baseline(app, admin_client):
    now = utcnow()
    today = now.date()
    async with app.state.db.sessionmaker() as db:
        # Ten earlier days: world 4 per hour, Ukraine 2 per hour, 24 h each.
        for d in range(1, 11):
            day = today - timedelta(days=d)
            db.add(TensionDaily(day=day, area="world", total=96, samples=24))
            db.add(TensionDaily(day=day, area="Ukraine", total=48, samples=24))
        db.add(
            Event(
                id="EVT1",
                type="conflict",
                severity=4,
                status="active",
                title="Strikes on Kharkiv",
                country="Ukraine",
                lat=50.0,
                lon=36.2,
                first_seen=now,
                last_updated=now,
                confidence=1.0,
            )
        )
        await db.commit()
        assert await tension.record_sample(db, now) >= 3
        await db.commit()
        rows = {
            r.area: r
            for r in (
                await db.execute(
                    TensionDaily.__table__.select().where(
                        TensionDaily.day == today
                    )
                )
            ).all()
        }
        assert rows["Ukraine"].total == 4.0
        base, days = await tension.baselines(db, today)
        assert days == 10
        assert base["world"] == 4.0
        assert base["Ukraine"] == 2.0

    body = (await admin_client.get("/api/tension")).json()
    assert body["baseline_ready"] is True
    ukraine = next(c for c in body["countries"] if c["name"] == "Ukraine")
    assert ukraine["level"] == 100
    assert ukraine["band"] == "extreme"
    assert ukraine["raw"] == 4.0
    assert ukraine["vs_normal"] == 100  # twice its usual live activity
    assert ukraine["events"] == {"conflict": 1}
    assert ukraine["top"][0]["id"] == "EVT1"
    east = next(t for t in body["theatres"] if t["key"] == "eastern-europe")
    assert east["level"] >= 50
    assert body["ucdp_through"]
    assert 0 < body["world"]["level"] <= 100


async def test_tension_requires_sign_in(client):
    assert (await client.get("/api/tension")).status_code == 401


async def test_worker_samples_once_per_hour(app):
    from argus.worker import tension_once

    assert await tension_once(app.state.db) is True
    assert await tension_once(app.state.db) is False


async def test_backfill_from_stored_events(app):
    now = utcnow().replace(minute=30)
    async with app.state.db.sessionmaker() as db:
        for d in (1, 3, 5):
            db.add(
                Event(
                    id="B{0}".format(d),
                    type="conflict",
                    severity=3,
                    status="expired" if d > 1 else "active",
                    title="Clashes",
                    country="Sudan",
                    lat=15.5,
                    lon=32.5,
                    first_seen=now - timedelta(days=d),
                    last_updated=now - timedelta(days=d),
                    confidence=0.9,
                )
            )
        await db.commit()
        hours = await tension.backfill(db, now)
        await db.commit()
        # From the oldest event's hour up to (not including) this hour.
        assert 5 * 24 - 1 <= hours <= 5 * 24 + 1
        base, days = await tension.baselines(db, now.date())
        assert days >= 5
        assert base["Sudan"] > 0
        # Never twice.
        assert await tension.backfill(db, now) == 0


async def test_live_news_alone_stays_moderate(app, admin_client):
    now = utcnow()
    async with app.state.db.sessionmaker() as db:
        for i, country in enumerate(("Canada", "Canada", "Canada")):
            db.add(
                Event(
                    id="C{0}".format(i),
                    type="conflict",
                    severity=3,
                    status="active",
                    title="Clashes",
                    country=country,
                    lat=49.0,
                    lon=32.0,
                    first_seen=now,
                    last_updated=now,
                    confidence=1.0,
                )
            )
        await db.commit()
    async with app.state.db.sessionmaker() as db:
        body = await tension.snapshot(db, limit=200)
    assert body["baseline_days"] == 0
    canada = next(c for c in body["countries"] if c["name"] == "Canada")
    # Three fresh clashes in a country UCDP has as nearly calm: mostly
    # live points, well below the countries at war.
    assert canada["standing"] < 25
    assert canada["level"] < 40
    assert canada["vs_normal"] is None
    assert body["countries"][0]["name"] in ("Ukraine", "Sudan")


async def test_history_per_theatre(app, admin_client):
    today = utcnow().date()
    async with app.state.db.sessionmaker() as db:
        for d in range(3):
            day = today - timedelta(days=d)
            db.add(TensionDaily(day=day, area="world", total=48, samples=24))
            db.add(
                TensionDaily(
                    day=day,
                    area="theatre:eastern-europe",
                    total=24 * d,
                    samples=24,
                )
            )
        await db.commit()
    body = (await admin_client.get("/api/tension/history?days=3")).json()
    east = body["areas"]["eastern-europe"]
    assert [p["raw"] for p in east] == [2.0, 1.0, 0.0]
    assert len(body["areas"]["world"]) == 3
