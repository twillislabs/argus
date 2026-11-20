"""Events led by headlines: US stories several outlets run at once.

GDELT misses or misplaces plenty of US news (a derailment, an airport
ground stop, a refinery fire). When three or more outlets in the news
feeds run the same story (argus.story) naming the same US city or
state, and it's about something happening (a shooting, crash, fire,
outage...), it becomes an "incident" event there, keyed "news:<id>"
and kept up to date as more headlines come in. Stories a confirmed
GDELT event already tells are left to it.
"""

import re
import secrets
from collections import Counter
from datetime import timedelta
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from argus import places, story
from argus.db import utcnow
from argus.geo import distance_km
from argus.models import Article, Event

WINDOW = timedelta(hours=24)
MIN_OUTLETS = 3
# How close headlines must be to tell the same story.
SAME_STORY = 0.3
CITY_MIN_POP = 100_000
NEAR_KM = 50

# Something happening, not someone saying something.
HAPPENING = re.compile(
    r"\b(shoot(s|ing|ings|er)?|shot dead|gunman|gunfire|stabb(ing|ed)|"
    r"explosions?|blasts?|explodes?|fires?|wildfires?|blaze|burns?|"
    r"crash(es|ed)?|derail\w*|collaps\w*|evacuat\w*|lockdown|"
    r"outages?|blackouts?|power cut|grounded|ground stop|hostages?|"
    r"standoff|manhunt|bomb(s|ing)?|bomb threat|tornado(es)?|floods?|"
    r"flooding|hurricane|storms?|blizzard|earthquake|spill|leak|"
    r"chemical|toxic|poison\w*|outbreak|cyberattack|hack(ed)?|riots?|"
    r"protests?|protesters|killed|dead|deaths?|injured|missing|"
    r"rescued?|sinkhole|attack(s|ed)?|threats?|emergency|closed|"
    r"shut(s)? down|strike)\b",
    re.IGNORECASE,
)
# Words that, without a physical event word, mean a political story.
POLITICS = re.compile(
    r"\b(trump|biden|vance|harris|senate|congress|house gop|democrats?|"
    r"republicans?|gop|election|campaign|poll|votes?|governor|mayor|"
    r"lawmakers?|bill|white house|administration|supreme court|lawsuit|"
    r"judge|court)\b",
    re.IGNORECASE,
)
PHYSICAL = re.compile(
    r"\b(shoot\w*|gunman|gunfire|stabb\w*|explosions?|blasts?|"
    r"wildfires?|blaze|crash(es|ed)?|derail\w*|collaps\w*|evacuat\w*|"
    r"outages?|blackouts?|tornado(es)?|flood\w*|hurricane|earthquake|"
    r"spill|hostages?|manhunt|riots?)\b",
    re.IGNORECASE,
)
OPINION = re.compile(
    r"^(opinion|analysis|comment|editorial|explainer|watch|live|"
    r"letters?|why|how|what|who|is|are|can|should|will)\b|\?",
    re.IGNORECASE,
)
MAJOR = re.compile(
    r"\b(mass|terror\w*|explosions?|bomb\w*|hostages?|massacre|"
    r"dozens|evacuat\w*|grounded|ground stop|derail\w*|collaps\w*|"
    r"tornado(es)?|hurricane|several|multiple|killed|dead)\b",
    re.IGNORECASE,
)

# City names that are elsewhere too, or say something else in a
# headline ("Washington" is the government).
AMBIGUOUS = {
    "washington", "birmingham", "manchester", "cambridge", "athens",
    "vancouver", "richmond", "lancaster", "hamilton", "victoria",
    "paris", "london", "columbia", "independence", "mobile", "surprise",
    "orange", "lafayette", "peoria", "glendale", "springfield",
    "aurora", "columbus", "jackson", "lincoln", "warren", "york",
    "concord", "frisco", "miramar", "pearland", "league city", "provo",
    "temple", "allen", "edison", "norman", "odessa", "salem", "dayton",
    "kent", "carmel", "fargo", "eugene", "cary", "macon", "billings",
    "hollywood", "orlando bloom", "phoenix suns",
}  # fmt: skip
# States that are also countries or words. Georgia counts unless the
# headline is about the country.
STATE_SKIP = {"washington"}
GEORGIA_COUNTRY = re.compile(
    r"\b(tbilisi|georgian|georgia's dream|kobakhidze|caucasus|abkhaz\w*|"
    r"south ossetia)\b",
    re.IGNORECASE,
)
# Stories about the whole country (systems down, flights grounded) that
# name no place: placed at the middle of the contiguous states.
NATIONWIDE = re.compile(
    r"\b(outages?|blackouts?|cyber ?attacks?|hack(ed|ers)?|grounded|"
    r"ground stop|data breach|systems? (down|failure|outage))\b",
    re.IGNORECASE,
)
US_MARKER = re.compile(
    r"\b(U\.S\.|US|USA|America|American|Americans|nationwide|"
    r"across the country|FAA|FBI|TSA|CISA|FEMA|White House|Pentagon)\b"
)
CENTRE = ("us:nationwide", "Nationwide, United States", 39.83, -98.58)


@lru_cache(maxsize=1)
def us_places() -> tuple[dict[str, places.Place], dict[str, tuple]]:
    """Folded US city names (100,000+ people) to their place, and folded
    state names to (state, lat, lon) at their people's centre."""
    cities: dict[str, places.Place] = {}
    sums: dict[str, list[float]] = {}
    for p in places.load():
        if p.cc != "US":
            continue
        s = sums.setdefault(p.region, [0.0, 0.0, 0.0])
        s[0] += p.lat * p.population
        s[1] += p.lon * p.population
        s[2] += p.population
        if p.population < CITY_MIN_POP or p.key in AMBIGUOUS:
            continue
        cur = cities.get(p.key)
        if cur is None or p.population > cur.population:
            cities[p.key] = p
    states = {}
    for name in places.US_STATES.values():
        key = places.fold(name)
        s = sums.get(name)
        if key in STATE_SKIP or not s or not s[2]:
            continue
        states[key] = (name, s[0] / s[2], s[1] / s[2])
    return cities, states


def place_named(title: str) -> tuple[str, str, float, float] | None:
    """The US city (or else state) a headline names, as (key, label,
    lat, lon)."""
    words = places.fold(title).split()
    cities, states = us_places()
    found_state = None
    for n in (3, 2, 1):
        for i in range(len(words) - n + 1):
            key = " ".join(words[i : i + n])
            if key in cities:
                p = cities[key]
                return (
                    "city:{0}".format(key),
                    "{0}, {1}, United States".format(p.name, p.region),
                    p.lat,
                    p.lon,
                )
            if key == "georgia" and GEORGIA_COUNTRY.search(title):
                continue
            if key in states and found_state is None:
                name, lat, lon = states[key]
                found_state = (
                    "state:{0}".format(key),
                    "{0}, United States".format(name),
                    lat,
                    lon,
                )
    if found_state is None and nationwide(title):
        return CENTRE
    return found_state


def nationwide(title: str) -> bool:
    return bool(NATIONWIDE.search(title) and US_MARKER.search(title))


def newsworthy(title: str) -> bool:
    if OPINION.search(title.strip()) or not HAPPENING.search(title):
        return False
    if nationwide(title):
        return True
    return not POLITICS.search(title) or bool(PHYSICAL.search(title))


def headline(title: str) -> str:
    t = re.sub(
        r"\s+[-|–]\s+[^-|–]{2,40}$", "", " ".join((title or "").split())
    )
    return t[:300]


async def review(db: AsyncSession) -> set[str]:
    """Create or update headline-led events. Returns ids changed."""
    now = utcnow()
    rows = list(
        (
            await db.execute(
                select(Article).where(Article.published_at >= now - WINDOW)
            )
        ).scalars()
    )
    weights = story.Weights(story.title_terms(a.title) for a in rows)
    picked = []
    for a in rows:
        if not newsworthy(a.title):
            continue
        place = place_named(a.title)
        terms = story.title_terms(a.title)
        if place and story.readable(terms):
            picked.append((a, place, terms))
    groups = story.clusters([t for _, _, t in picked], weights, SAME_STORY)
    existing = list(
        (
            await db.execute(
                select(Event).where(
                    Event.status != "expired",
                    Event.last_updated >= now - 2 * WINDOW,
                )
            )
        ).scalars()
    )
    mine = [e for e in existing if (e.key or "").startswith("news:")]
    confirmed = [e for e in existing if e.key is None and e.status == "active"]
    quakes = [e for e in existing if e.type == "quake"]
    changed: set[str] = set()
    for group in groups:
        items = [picked[i] for i in group]
        outlets = {a.outlet for a, _, _ in items}
        if len(outlets) < MIN_OUTLETS:
            continue
        # Where: the place most headlines name, a city over its state.
        counts = Counter(p for _, p, _ in items)
        cities = [p for p in counts if p[0].startswith("city:")]
        place = (
            max(cities, key=lambda p: counts[p])
            if cities and max(counts[p] for p in cities) >= 2
            else counts.most_common(1)[0][0]
        )
        ids = [a.id for a, _, _ in items]
        terms = [t for _, _, t in items]
        event = _match(mine, ids, terms, weights)
        if _told_by_gdelt(confirmed, place, ids, terms, weights) or _is_quake(
            quakes, place, items
        ):
            # A confirmed GDELT event tells it now: leave it to that one.
            if event is not None and event.status != "expired":
                event.status = "expired"
                changed.add(event.id)
            continue
        fields = _fields(items, place, terms, weights)
        if event is None:
            from argus.fusion import new_event_id

            event = Event(
                id=new_event_id(),
                key="news:{0}".format(secrets.token_hex(8)),
                first_seen=fields.pop("first_seen"),
                **fields,
            )
            db.add(event)
            mine.append(event)
        else:
            fields.pop("first_seen")
            for name, value in fields.items():
                setattr(event, name, value)
        changed.add(event.id)
    await db.flush()
    return changed


def _told_by_gdelt(confirmed, place, ids, terms, weights) -> bool:
    """A confirmed GDELT event nearby backed by these headlines, or
    whose links tell this story."""
    from argus.fusion import HEADLINE_MATCH, event_terms

    for e in confirmed:
        if distance_km(e.lat, e.lon, place[2], place[3]) > NEAR_KM * 4:
            continue
        backing = set((e.data or {}).get("corroboration") or [])
        if backing & set(ids):
            return True
        links = event_terms(e)
        if links and any(
            story.best_match(t, links, weights) >= HEADLINE_MATCH
            for t in terms
        ):
            return True
    return False


QUAKE_WORDS = re.compile(r"\b(earthquakes?|quakes?|tremors?)\b", re.I)


def _is_quake(quakes, place, items) -> bool:
    """Earthquake headlines near a USGS quake: the quake event has
    them."""
    if sum(bool(QUAKE_WORDS.search(a.title)) for a, _, _ in items) * 2 < len(
        items
    ):
        return False
    return any(
        distance_km(e.lat, e.lon, place[2], place[3]) <= NEAR_KM * 6
        for e in quakes
    )


def _match(mine, ids, terms, weights) -> Event | None:
    """The headline-led event already telling this story."""
    best, best_share = None, 0.0
    for e in mine:
        theirs = set((e.data or {}).get("articles") or [])
        if theirs & set(ids):
            return e
        titles = [
            story.title_terms(t) for t in (e.data or {}).get("titles") or []
        ]
        share = story.shared_story(terms, titles, weights, SAME_STORY)
        if share >= 0.5 and share > best_share:
            best, best_share = e, share
    return best


def _fields(items, place, terms, weights) -> dict:
    # The most typical headline (closest to the others) is the title.
    def centrality(i: int) -> float:
        return sum(
            weights.similarity(terms[i], t)
            for j, t in enumerate(terms)
            if j != i
        )

    items_sorted = sorted(items, key=lambda x: x[0].published_at)
    best = max(range(len(items)), key=centrality)
    outlets = list(dict.fromkeys(a.outlet for a, _, _ in items_sorted))
    titles = [a.title for a, _, _ in items_sorted]
    major = sum(bool(MAJOR.search(t)) for t in titles) * 2 >= len(titles)
    return {
        "type": "incident",
        "severity": 3 if major else 2,
        "status": "active",
        "title": headline(items[best][0].title),
        "summary": "Reported by {0} outlets in your news feeds: {1}.".format(
            len(outlets), ", ".join(outlets[:6])
        ),
        "place": place[1][:200],
        "country": "United States",
        "lat": round(place[2], 4),
        "lon": round(place[3], 4),
        "first_seen": items_sorted[0][0].published_at,
        "last_updated": items_sorted[-1][0].published_at,
        "confidence": round(min(0.9, 0.3 + 0.1 * len(outlets)), 2),
        "source_count": len(outlets),
        "article_count": len(items),
        "data": {
            "source": "news",
            "articles": [a.id for a, _, _ in items_sorted][-40:],
            "titles": titles[-20:],
            "outlets": outlets[:20],
            "place_key": place[0],
        },
    }


# --- top stories for the Brief ---------------------------------------------

# Acronyms match in capitals only ("US", not "us"); words in any case.
US_ACRONYMS = re.compile(
    r"\b(U\.S\.|US|USA|FAA|FBI|TSA|CISA|FEMA|ICE|DOJ|CDC|IRS|GOP|MAGA|"
    r"NYC|NYPD|LAPD)\b"
)
US_WORDS = re.compile(
    r"\b(america|american|americans|nationwide|pentagon|white house|"
    r"congress|senate|house|capitol|supreme court|trump|biden|vance|"
    r"harris|democrats?|republicans?|midterms?|wall street|medicare|"
    r"medicaid|hegseth|rubio|newsom|desantis|mamdani|rikers|hollywood|"
    r"silicon valley|schumer|pelosi|governor|sheriff)\b",
    re.IGNORECASE,
)
# Outlets in the default feeds based outside the US, for stories that
# name no country at all.
NON_US_OUTLETS = {
    "The Guardian", "BBC News", "GB News", "France 24", "Al Jazeera",
    "DW", "Kyiv Independent", "Times of Israel", "Sky News",
    "The Telegraph", "The Spectator", "Daily Express", "The Times",
}  # fmt: skip


def us_named(title: str) -> bool:
    return bool(
        place_named(title)
        or US_ACRONYMS.search(title)
        or US_WORDS.search(title)
    )


@lru_cache(maxsize=1)
def foreign_names() -> frozenset[str]:
    """Folded names of other countries and their big cities (and the
    words for their people, which headlines use more)."""
    names = set()
    for p in places.load():
        if p.cc == "US":
            continue
        if p.country_key:
            names.add(p.country_key)
        if p.population >= 1_000_000 and len(p.key) >= 4:
            names.add(p.key)
    from argus.story import FOLD

    names.update(k for k, v in FOLD.items() if v not in ("america", "kyiv"))
    names.update({"kremlin", "nato", "putin", "zelensky", "netanyahu",
                  "starmer", "macron", "brexit", "xi", "hamas", "hezbollah",
                  "houthi", "houthis", "eu", "un"})  # fmt: skip
    return frozenset(names)


def us_or_world(titles: list[str], outlets: list[str] = ()) -> str:
    """Whether a story is about the US ("us") or not ("world"): most
    headlines name the US and few another country, or (naming neither)
    most outlets running it are American."""
    foreign = foreign_names()
    us = abroad = 0
    for t in titles:
        if us_named(t):
            us += 1
        words = places.fold(t).split()
        grams = set(words) | {
            " ".join(words[i : i + 2]) for i in range(len(words) - 1)
        }
        if grams & foreign:
            abroad += 1
    n = max(1, len(titles))
    american = (
        sum(o not in NON_US_OUTLETS for o in outlets) / len(outlets)
        if outlets
        else 0.0
    )
    if us / n >= 0.5 and abroad / n < 0.3:
        return "us"
    if us / n >= 0.2 and abroad / n < 0.1 and american >= 0.6:
        return "us"
    if not us and not abroad and american >= 0.75:
        return "us"
    return "world"


TOP_HOURS = 24


async def top_stories(db: AsyncSession, limit: int = 10) -> dict:
    """The day's biggest stories in the news feeds, by how many outlets
    run them, split into US and world."""
    since = utcnow() - timedelta(hours=TOP_HOURS)
    rows = [
        a
        for a in (
            await db.execute(
                select(Article)
                .where(Article.published_at >= since)
                .order_by(Article.published_at.desc())
            )
        ).scalars()
        if not OPINION.search(a.title.strip())
    ]
    terms = [story.title_terms(a.title) for a in rows]
    weights = story.Weights(terms)
    keep = [i for i, t in enumerate(terms) if story.readable(t)]
    groups = story.clusters([terms[i] for i in keep], weights)
    out: dict[str, list] = {"us": [], "world": []}
    for g in groups:
        items = [rows[keep[i]] for i in g]
        outlets = list(dict.fromkeys(a.outlet for a in items))
        if len(outlets) < 2:
            continue
        sub = [terms[keep[i]] for i in g]

        def centrality(k: int, sub: list = sub) -> float:
            return sum(
                weights.similarity(sub[k], t)
                for j, t in enumerate(sub)
                if j != k
            )

        lead = items[max(range(len(items)), key=centrality)]
        out[us_or_world([a.title for a in items], outlets)].append(
            {
                "title": headline(lead.title),
                "url": lead.url,
                "outlet": lead.outlet,
                "outlets": outlets[:12],
                "outlet_count": len(outlets),
                "latest": max(a.published_at for a in items).isoformat(),
                "articles": [
                    {
                        "outlet": a.outlet,
                        "title": a.title,
                        "url": a.url,
                        "published_at": a.published_at.isoformat(),
                    }
                    for a in sorted(
                        items, key=lambda a: a.published_at, reverse=True
                    )[:8]
                ],
            }
        )
    for k in out:
        out[k].sort(
            key=lambda s: (s["outlet_count"], s["latest"]), reverse=True
        )
        out[k] = out[k][:limit]
    return out
