"""Tension index: how much organised violence a country, theatre or the
world is seeing, on a 0-100 scale that lines up with conflict indexes
built on the same kind of data (ACLED, UCDP, the Global Peace Index).

Two parts:

- **Standing level**, from UCDP (Uppsala Conflict Data Program, CC BY
  4.0): deaths from state-based, non-state and one-sided violence over
  the last twelve months of data, bundled in data/conflict.tsv.gz by
  scripts/build_conflict.py. On a log scale: 10 deaths a year is about
  21, 1,000 about 64, 50,000 or more 100.
- **Live activity**, from Argus's own confirmed conflict, unrest and
  maritime-security events: severity × confidence × type weight, halving
  every 12 hours (the *raw* score). It adds up to 20 points, so a
  country UCDP has as calm only reaches "elevated" on live news alone.
  Unconfirmed GDELT reports don't count: most are noise from
  English-language coverage.

level = min(100, standing + live). Bands follow World Tension Meter:
calm 0-39, stable 40-54, moderate 55-67, high 68-77, extreme 78-100.
The world is the mean of the 40 highest countries; a theatre is led
by its highest country (60%) with the mean of its top three (40%).

Separately, the worker samples raw scores hourly into tension_daily, and
"vs normal" compares today's live activity with its 90-day average once
there are three days of history.
"""

import bisect
import gzip
import math
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import lru_cache
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
CONFLICT_DATA = os.path.join(
    os.path.dirname(__file__), "data", "conflict.tsv.gz"
)
# Deaths a year that score 100 on the standing level.
STANDING_REF = 50_000
LIVE_MAX = 20.0
WORLD_TOP = 40
THEATRE_TOP = 3
# Places GDELT puts in Israel that are Palestinian territory.
PALESTINE_PLACES = (
    "gaza",
    "rafah",
    "khan yunis",
    "khan younis",
    "jabalia",
    "west bank",
    "ramallah",
    "jenin",
    "nablus",
    "hebron",
    "tulkarm",
)

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
    Theatre(
        "americas",
        "Americas",
        (-170.0, -56.0, -30.0, 72.0),
        frozenset(
            {
                "United States",
                "Canada",
                "Mexico",
                "Guatemala",
                "Honduras",
                "El Salvador",
                "Nicaragua",
                "Costa Rica",
                "Panama",
                "Cuba",
                "Haiti",
                "Dominican Republic",
                "Jamaica",
                "Colombia",
                "Venezuela",
                "Ecuador",
                "Peru",
                "Bolivia",
                "Brazil",
                "Paraguay",
                "Uruguay",
                "Argentina",
                "Chile",
                "Trinidad and Tobago",
            }
        ),
    ),
)
THEATRE_BY_ID = {t.id: t for t in THEATRES}


def country_name(raw: str) -> str:
    name = (raw or "").strip()
    return ALIASES.get(name, name)


def event_country(e: Any) -> str:
    country = country_name(e.country)
    if country == "Israel" and (e.place or "").lower().startswith(
        PALESTINE_PLACES
    ):
        return "Palestine"
    return country


@lru_cache(maxsize=1)
def conflict_data(path: str = CONFLICT_DATA) -> tuple[dict[str, dict], str]:
    """UCDP deaths per country (12 months and the 12 before), and the
    month the data runs to."""
    out: dict[str, dict] = {}
    through = ""
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                if line.startswith("#"):
                    through = line.rsplit(" ", 1)[-1].strip()
                    continue
                parts = line.rstrip("\n").split("\t")
                if parts[0] == "country" or len(parts) < 4:
                    continue
                out[parts[0]] = {
                    "deaths_12m": int(parts[1]),
                    "deaths_prev_12m": int(parts[2]),
                    "events_12m": int(parts[3]),
                }
    except FileNotFoundError:
        pass
    return out, through


def standing(deaths: int) -> float:
    if deaths <= 0:
        return 0.0
    return min(
        100.0, 100 * math.log10(1 + deaths) / math.log10(1 + STANDING_REF)
    )


def live_points(raw: float) -> float:
    return min(LIVE_MAX, 8 * math.log2(1 + max(0.0, raw)))


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
        country = event_country(e)
        scores[WORLD] += w
        if country:
            scores[country] = scores.get(country, 0.0) + w
        theatre = theatre_for(country, e.lat, e.lon)
        if theatre:
            key = "theatre:" + theatre
            scores[key] = scores.get(key, 0.0) + w
    return scores


def level(standing_points: float, raw: float) -> int:
    return min(100, round(standing_points + live_points(raw)))


# The bands World Tension Meter uses, so the two read alike.
BANDS = ((78, "extreme"), (68, "high"), (55, "moderate"), (40, "stable"))


def band(value: int) -> str:
    return next((name for floor, name in BANDS if value >= floor), "calm")


def vs_normal(raw: float, base: float | None) -> int | None:
    """Live activity against its 90-day average, in percent."""
    if base is None:
        return None
    return round((raw / max(base, MIN_BASELINE) - 1) * 100)


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


async def history(
    db: AsyncSession, today: date, days: int = 14
) -> dict[str, list[dict[str, Any]]]:
    """Average hourly live activity (raw score) per world and theatre for
    each of the last `days` days, oldest first, for trend lines."""
    since = today - timedelta(days=days - 1)
    rows = (
        await db.execute(
            select(TensionDaily).where(
                TensionDaily.day >= since,
                (TensionDaily.area == WORLD)
                | TensionDaily.area.like("theatre:%"),
            )
        )
    ).scalars()
    hours: dict[date, int] = {}
    totals: dict[str, dict[date, float]] = {}
    for r in rows:
        if r.area == WORLD:
            hours[r.day] = r.samples
        totals.setdefault(r.area, {})[r.day] = r.total
    out: dict[str, list[dict[str, Any]]] = {}
    for area, by_day in totals.items():
        key = area.removeprefix("theatre:")
        out[key] = [
            {
                "day": (since + timedelta(days=i)).isoformat(),
                "raw": round(
                    by_day.get(since + timedelta(days=i), 0.0)
                    / max(1, hours.get(since + timedelta(days=i), 0)),
                    2,
                ),
            }
            for i in range(days)
        ]
    return out


async def prune(db: AsyncSession, today: date) -> None:
    await db.execute(
        delete(TensionDaily).where(
            TensionDaily.day < today - timedelta(days=BASELINE_DAYS + 5)
        )
    )


def _country(
    name: str,
    raw: float,
    before: float,
    base: float | None,
    ucdp: dict | None,
) -> dict[str, Any]:
    stand = standing(ucdp["deaths_12m"]) if ucdp else 0.0
    value = level(stand, raw)
    return {
        "key": name,
        "name": name,
        "level": value,
        "band": band(value),
        "standing": round(stand),
        "live": round(live_points(raw)),
        "raw": round(raw, 2),
        "deaths_12m": ucdp["deaths_12m"] if ucdp else 0,
        "deaths_prev_12m": ucdp["deaths_prev_12m"] if ucdp else 0,
        "vs_normal": vs_normal(raw, base),
        "change_24h": value - level(stand, before),
    }


def _combine(levels: list[int], top: int, lead: float) -> int:
    best = sorted(levels, reverse=True)[:top]
    best += [0] * (top - len(best))
    mean = sum(best) / top
    return round(lead * best[0] + (1 - lead) * mean)


def _rollup(
    key: str, name: str, members: list[dict], top: int, lead: float = 0.0
) -> dict:
    value = _combine([c["level"] for c in members], top, lead)
    before = _combine(
        [c["level"] - c["change_24h"] for c in members], top, lead
    )
    return {
        "key": key,
        "name": name,
        "level": value,
        "band": band(value),
        "change_24h": value - before,
    }


def _top_events(events: list, now: datetime, key: str, n: int = 3) -> list:
    picked = []
    for e in events:
        country = event_country(e)
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
    db: AsyncSession, now: datetime | None = None, limit: int = 150
) -> dict[str, Any]:
    now = now or utcnow()
    events = await recent_events(db, now)
    current = raw_scores(events, now)
    before = raw_scores(events, now - timedelta(hours=24))
    base, days = await baselines(db, now.date())
    usable = days >= MIN_USABLE_DAYS
    ucdp, through = conflict_data()

    by_type: dict[str, dict[str, int]] = {}
    for e in events:
        if weight(e, now) <= 0:
            continue
        country = event_country(e)
        if country:
            counts = by_type.setdefault(country, {})
            counts[e.type] = counts.get(e.type, 0) + 1

    names = {
        k for k in current if k != WORLD and not k.startswith("theatre:")
    } | set(ucdp)
    countries = []
    for name in names:
        item = _country(
            name,
            current.get(name, 0.0),
            before.get(name, 0.0),
            base.get(name, 0.0) if usable else None,
            ucdp.get(name),
        )
        if item["level"] < 1:
            continue
        item["events"] = by_type.get(name, {})
        item["top"] = _top_events(events, now, name)
        item["theatre"] = theatre_for(name, 0.0, 0.0)
        countries.append(item)
    countries.sort(key=lambda c: (c["level"], c["raw"]), reverse=True)

    theatres = []
    for t in THEATRES:
        members = [c for c in countries if c["theatre"] == t.id]
        item = _rollup(t.id, t.name, members, THEATRE_TOP, lead=0.6)
        item["bbox"] = list(t.bbox)
        item["top"] = _top_events(events, now, "theatre:" + t.id)
        item["countries"] = [c["name"] for c in members][:5]
        theatres.append(item)

    world = _rollup(WORLD, "World", countries, WORLD_TOP)
    world["top"] = _top_events(events, now, WORLD, 5)
    world["raw"] = round(current[WORLD], 2)
    world["vs_normal"] = vs_normal(
        current[WORLD], base.get(WORLD) if usable else None
    )
    return {
        "updated": now.isoformat(),
        "baseline_days": days,
        "baseline_ready": days >= MIN_BASELINE_DAYS,
        "ucdp_through": through,
        "world": world,
        "theatres": theatres,
        "countries": countries[:limit],
        "method": {
            "standing": "UCDP deaths, last 12 months (CC BY 4.0)",
            "standing_ref_deaths": STANDING_REF,
            "live_max": LIVE_MAX,
            "half_life_h": HALF_LIFE_H,
            "baseline_days": BASELINE_DAYS,
            "weights": WEIGHTS,
        },
    }
