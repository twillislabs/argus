"""Tension index: how tense a country, theatre or the world is right now
compared with its own recent past.

Each confirmed conflict, unrest or maritime-security event adds
severity × confidence × type weight, halving every 12 hours since it was
last updated. Unconfirmed (candidate) GDELT reports don't count: most are
noise from English-language coverage (a "military force" report placed
at the White House). That sum is the area's *raw* score.

The worker samples raw scores every hour into `tension_daily` (one row per
area per day: the sum of samples and how many there were). The baseline is
the mean hourly raw score over the 90 days before today. The index is

    r = raw / max(baseline, MIN_BASELINE)
    level = 100 × r / (r + 1)

so 50 is normal for that area, 67 is twice normal and 75 three times. The
floor keeps a quiet country with one event from jumping to 100.
"""

import bisect
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from argus.db import utcnow
from argus.models import Event, TensionDaily

WEIGHTS = {"conflict": 1.0, "unrest": 0.6, "maritime": 0.8}
CANDIDATE_FACTOR = 0.0
HALF_LIFE_H = 12.0
# Older events add under 0.5% of their weight.
WINDOW = timedelta(hours=96)
BASELINE_DAYS = 90
# Days of samples before the baseline is trusted, and before it's used
# at all (a day or two of history says little about normal).
MIN_BASELINE_DAYS = 7
MIN_USABLE_DAYS = 3
MIN_BASELINE = 2.0
WORLD = "world"
MIN_RAW_LISTED = 0.5

# GDELT and RSS place names for the same country.
ALIASES = {
    "Gaza Strip": "Palestine",
    "West Bank": "Palestine",
    "Palestinian Territories": "Palestine",
    "Burma": "Myanmar",
    "Czech Republic": "Czechia",
    "Ivory Coast": "Côte d'Ivoire",
    "Cote d'Ivoire": "Côte d'Ivoire",
    "Macedonia": "North Macedonia",
    "Swaziland": "eSwatini",
    "Congo, Democratic Republic of the": "Democratic Republic of the Congo",
}


@dataclass(frozen=True)
class Theatre:
    id: str
    name: str
    # west, south, east, north: where the map opens, and where events
    # with no country (at sea) are placed.
    bbox: tuple[float, float, float, float]
    countries: frozenset[str] = field(default_factory=frozenset)


THEATRES = (
    Theatre(
        "middle-east",
        "Middle East & Red Sea",
        (24.0, 8.0, 63.0, 42.0),
        frozenset(
            {
                "Israel",
                "Palestine",
                "Lebanon",
                "Syria",
                "Iraq",
                "Iran",
                "Jordan",
                "Saudi Arabia",
                "Yemen",
                "Egypt",
                "Turkey",
                "Kuwait",
                "Qatar",
                "Bahrain",
                "United Arab Emirates",
                "Oman",
                "Sudan",
                "Eritrea",
                "Djibouti",
                "Somalia",
                "Ethiopia",
            }
        ),
    ),
    Theatre(
        "eastern-europe",
        "Eastern Europe",
        (14.0, 40.0, 50.0, 62.0),
        frozenset(
            {
                "Ukraine",
                "Russia",
                "Belarus",
                "Moldova",
                "Poland",
                "Romania",
                "Lithuania",
                "Latvia",
                "Estonia",
                "Georgia",
                "Armenia",
                "Azerbaijan",
                "Serbia",
                "Kosovo",
            }
        ),
    ),
    Theatre(
        "sahel",
        "Sahel",
        (-18.0, 4.0, 25.0, 25.0),
        frozenset(
            {
                "Mali",
                "Burkina Faso",
                "Niger",
                "Chad",
                "Mauritania",
                "Nigeria",
                "Cameroon",
                "Senegal",
                "Libya",
                "Central African Republic",
            }
        ),
    ),
    Theatre(
        "indo-pacific",
        "Indo-Pacific",
        (62.0, -12.0, 150.0, 48.0),
        frozenset(
            {
                "China",
                "Taiwan",
                "Japan",
                "North Korea",
                "South Korea",
                "Philippines",
                "Vietnam",
                "India",
                "Pakistan",
                "Afghanistan",
                "Myanmar",
                "Indonesia",
                "Malaysia",
                "Thailand",
                "Bangladesh",
                "Sri Lanka",
                "Cambodia",
                "Laos",
                "Nepal",
            }
        ),
    ),
    Theatre("americas", "Americas", (-170.0, -56.0, -30.0, 72.0)),
)
THEATRE_BY_ID = {t.id: t for t in THEATRES}


def country_name(raw: str) -> str:
    name = (raw or "").strip()
    return ALIASES.get(name, name)


def theatre_for(country: str, lat: float, lon: float) -> str | None:
    for t in THEATRES:
        if country in t.countries:
            return t.id
    # Americas by longitude; anything else without a country by its box.
    if lon < -30:
        return "americas"
    if not country:
        for t in THEATRES:
            w, s, e, n = t.bbox
            if w <= lon <= e and s <= lat <= n:
                return t.id
    return None


def weight(e: Any, now: datetime) -> float:
    base = WEIGHTS.get(e.type)
    if base is None:
        return 0.0
    age_h = max(0.0, (now - e.last_updated).total_seconds() / 3600)
    value = e.severity * e.confidence * base * 0.5 ** (age_h / HALF_LIFE_H)
    if e.status == "candidate":
        value *= CANDIDATE_FACTOR
    return value


def raw_scores(events: list, now: datetime) -> dict[str, float]:
    """Raw score per area key: country names, 'theatre:<id>' and 'world'."""
    scores: dict[str, float] = {WORLD: 0.0}
    for e in events:
        if e.last_updated > now:
            continue
        w = weight(e, now)
        if w <= 0:
            continue
        country = country_name(e.country)
        scores[WORLD] += w
        if country:
            scores[country] = scores.get(country, 0.0) + w
        theatre = theatre_for(country, e.lat, e.lon)
        if theatre:
            key = "theatre:" + theatre
            scores[key] = scores.get(key, 0.0) + w
    return scores


def level(raw: float, baseline: float | None) -> int:
    r = raw / max(baseline or 0.0, MIN_BASELINE)
    return round(100 * r / (r + 1))


def band(value: int) -> str:
    if value >= 80:
        return "severe"
    if value >= 67:
        return "high"
    if value >= 55:
        return "elevated"
    return "normal"


async def recent_events(db: AsyncSession, now: datetime) -> list[Event]:
    rows = await db.execute(
        select(Event).where(
            Event.type.in_(list(WEIGHTS)),
            Event.status != "expired",
            Event.last_updated >= now - WINDOW - timedelta(hours=24),
        )
    )
    return list(rows.scalars())


async def record_sample(db: AsyncSession, now: datetime | None = None) -> int:
    """Add this hour's raw scores to today's rows. Returns areas written."""
    now = now or utcnow()
    scores = raw_scores(await recent_events(db, now), now)
    today = now.date()
    existing = {
        row.area: row
        for row in (
            await db.execute(
                select(TensionDaily).where(TensionDaily.day == today)
            )
        ).scalars()
    }
    for area, raw in scores.items():
        row = existing.get(area)
        if row is None:
            db.add(
                TensionDaily(day=today, area=area[:80], total=raw, samples=1)
            )
        else:
            row.total += raw
            row.samples += 1
    # Areas sampled earlier today but quiet now still count this hour.
    for area, row in existing.items():
        if area not in scores:
            row.samples += 1
    return len(scores)


async def backfill(db: AsyncSession, now: datetime | None = None) -> int:
    """Rebuild hourly samples from the events already stored, so a new
    install (or one upgraded to this version) has a baseline straight
    away instead of after a week. Only runs when there are no samples.
    Approximate: an event counts from its last update, not its first.
    Returns the hours written."""
    now = now or utcnow()
    if (
        await db.execute(select(func.count()).select_from(TensionDaily))
    ).scalar():
        return 0
    since = now - timedelta(days=BASELINE_DAYS) - WINDOW
    rows = await db.execute(
        select(Event)
        .where(
            Event.type.in_(list(WEIGHTS)),
            Event.last_updated >= since,
            Event.last_updated <= now,
        )
        .order_by(Event.last_updated)
    )
    events = list(rows.scalars())
    if not events:
        return 0
    stamps = [e.last_updated for e in events]
    hour = events[0].last_updated.replace(minute=0, second=0, microsecond=0)
    hour = max(hour, now - timedelta(days=BASELINE_DAYS))
    hour = hour.replace(minute=0, second=0, microsecond=0)
    end = now.replace(minute=0, second=0, microsecond=0)
    totals: dict[tuple[date, str], float] = {}
    hours: dict[date, int] = {}
    written = 0
    while hour < end:
        lo = bisect.bisect_right(stamps, hour - WINDOW)
        hi = bisect.bisect_right(stamps, hour)
        # Expiry doesn't apply to the past: score them as they were.
        scores = raw_scores([_as_active(e) for e in events[lo:hi]], hour)
        day = hour.date()
        hours[day] = hours.get(day, 0) + 1
        for area, raw in scores.items():
            totals[(day, area)] = totals.get((day, area), 0.0) + raw
        written += 1
        hour += timedelta(hours=1)
    for (day, area), total in totals.items():
        db.add(
            TensionDaily(
                day=day, area=area[:80], total=total, samples=hours[day]
            )
        )
    return written


def _as_active(e: Event) -> Any:
    if e.status != "expired":
        return e
    return _Past(e)


class _Past:
    """An expired event seen as it was before it expired."""

    def __init__(self, e: Event) -> None:
        self._e = e
        self.status = "active" if e.confidence >= 0.6 else "candidate"

    def __getattr__(self, name: str) -> Any:
        return getattr(self._e, name)


async def baselines(
    db: AsyncSession, today: date
) -> tuple[dict[str, float], int]:
    """Mean hourly raw score per area over the last 90 days (not today),
    and how many days of samples there are."""
    since = today - timedelta(days=BASELINE_DAYS)
    window = (TensionDaily.day >= since, TensionDaily.day < today)
    hours, days = (
        await db.execute(
            select(
                func.coalesce(func.sum(TensionDaily.samples), 0),
                func.count(),
            ).where(*window, TensionDaily.area == WORLD)
        )
    ).one()
    if not hours:
        return {}, 0
    totals = await db.execute(
        select(TensionDaily.area, func.sum(TensionDaily.total))
        .where(*window)
        .group_by(TensionDaily.area)
    )
    # An area missing from a day was quiet that day: divide by every
    # hour sampled, not just the hours it appeared in.
    return {area: total / hours for area, total in totals.all()}, days


async def prune(db: AsyncSession, today: date) -> None:
    await db.execute(
        delete(TensionDaily).where(
            TensionDaily.day < today - timedelta(days=BASELINE_DAYS + 5)
        )
    )


def _area(
    key: str, name: str, raw: float, before: float, base: float | None
) -> dict[str, Any]:
    value = level(raw, base)
    return {
        "key": key,
        "name": name,
        "level": value,
        "band": band(value),
        "raw": round(raw, 2),
        "baseline": round(base, 2) if base is not None else None,
        "change_24h": value - level(before, base),
    }


def _top_events(events: list, now: datetime, key: str, n: int = 3) -> list:
    picked = []
    for e in events:
        country = country_name(e.country)
        theatre = theatre_for(country, e.lat, e.lon)
        if key not in (WORLD, country, "theatre:{0}".format(theatre)):
            continue
        w = weight(e, now)
        if w > 0:
            picked.append((w, e))
    picked.sort(key=lambda p: p[0], reverse=True)
    return [
        {
            "id": e.id,
            "title": e.title,
            "type": e.type,
            "severity": e.severity,
            "status": e.status,
            "weight": round(w, 2),
        }
        for w, e in picked[:n]
    ]


async def snapshot(
    db: AsyncSession, now: datetime | None = None, limit: int = 30
) -> dict[str, Any]:
    now = now or utcnow()
    events = await recent_events(db, now)
    current = raw_scores(events, now)
    before = raw_scores(events, now - timedelta(hours=24))
    base, days = await baselines(db, now.date())
    trusted = days >= MIN_BASELINE_DAYS
    # With under three days of history, compare each country with a
    # typical country today, and the world and theatres with themselves
    # (50): there's nothing yet to say they're above normal.
    countries_now = [
        v
        for k, v in current.items()
        if k != WORLD and not k.startswith("theatre:") and v > 0
    ]
    typical = sum(countries_now) / len(countries_now) if countries_now else 0

    def baseline_for(key: str) -> float | None:
        if days >= MIN_USABLE_DAYS:
            # Some history: use it (flagged as learning until a week).
            return base.get(key, 0.0)
        if key == WORLD or key.startswith("theatre:"):
            return current.get(key) or None
        return typical

    by_type: dict[str, dict[str, int]] = {}
    for e in events:
        if weight(e, now) <= 0:
            continue
        country = country_name(e.country)
        if country:
            counts = by_type.setdefault(country, {})
            counts[e.type] = counts.get(e.type, 0) + 1

    countries = []
    for key, raw in current.items():
        if key == WORLD or key.startswith("theatre:"):
            continue
        if raw < MIN_RAW_LISTED:
            continue
        item = _area(key, key, raw, before.get(key, 0.0), baseline_for(key))
        item["events"] = by_type.get(key, {})
        item["top"] = _top_events(events, now, key)
        theatre = theatre_for(key, 0.0, 0.0)
        item["theatre"] = theatre if theatre != "americas" else None
        countries.append(item)
    # Highest level first; raw breaks ties so busier places lead.
    countries.sort(key=lambda c: (c["level"], c["raw"]), reverse=True)

    theatres = []
    for t in THEATRES:
        key = "theatre:" + t.id
        item = _area(
            t.id,
            t.name,
            current.get(key, 0.0),
            before.get(key, 0.0),
            baseline_for(key),
        )
        item["bbox"] = list(t.bbox)
        item["top"] = _top_events(events, now, key)
        item["countries"] = [
            c["name"] for c in countries if c.get("theatre") == t.id
        ][:5]
        theatres.append(item)

    world = _area(
        WORLD,
        "World",
        current[WORLD],
        before.get(WORLD, 0.0),
        baseline_for(WORLD),
    )
    world["top"] = _top_events(events, now, WORLD, 5)
    return {
        "updated": now.isoformat(),
        "baseline_days": days,
        "baseline_ready": trusted,
        "world": world,
        "theatres": theatres,
        "countries": countries[:limit],
        "method": {
            "half_life_h": HALF_LIFE_H,
            "baseline_days": BASELINE_DAYS,
            "weights": WEIGHTS,
            "candidate_factor": CANDIDATE_FACTOR,
        },
    }
