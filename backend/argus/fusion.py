"""Turn raw records into events (fusion v0).

- USGS quakes and FIRMS fire clusters map one-to-one onto events, keyed by
  their source id, and are updated in place when the source revises them.
- GDELT records are clustered: same event type, within 25 km and 2 h of an
  existing GDELT event. A cluster starts as a *candidate* and becomes
  *active* only when enough independent outlets report it.
- RSS items become articles, not map events.
"""

import re
import secrets
from collections import Counter
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from urllib.parse import urlsplit

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from argus import places, story
from argus.collectors.base import RawIn
from argus.collectors.gdelt import label_for
from argus.db import utcnow
from argus.geo import degrees_box, distance_km
from argus.models import Article, Event, EventSource, RawRecord

CLUSTER_KM = 25.0
CLUSTER_WINDOW = timedelta(hours=2)
ACTIVE_WINDOW = {
    "quake": timedelta(hours=72),
    # Hazards update when their source revises them (GDACS, EONET), which
    # can be days apart for a long flood or drought.
    "hazard": timedelta(days=7),
    # Active warnings refresh daily (see collectors.nga).
    "maritime": timedelta(days=2),
}

HAZARD_LABELS = {
    "flood": "Flood",
    "cyclone": "Tropical cyclone",
    "storm": "Severe storm",
    "volcano": "Volcano",
    "drought": "Drought",
    "wildfire": "Wildfire",
    "tsunami": "Tsunami",
    "landslide": "Landslide",
    "dust": "Dust and haze",
    "snow": "Snow",
    "heat": "Temperature extreme",
    "manmade": "Man-made event",
}
DEFAULT_ACTIVE_WINDOW = timedelta(hours=24)
# GDELT promotion thresholds: independent outlets and total articles.
PROMOTE_OUTLETS = 3
PROMOTE_ARTICLES = 10
# Catch-all codes fire on court cases, crime and political coverage (190
# military force, 192 occupation, 193 small arms), so clusters made only
# of these need much more corroboration.
GENERIC_CODES = {"190", "192", "193"}
PROMOTE_ARTICLES_GENERIC = 20

# GDELT codes violence (CAMEO 18x assault, 19x fight, 20x mass violence)
# from crime, crash and court stories as readily as from war. A cluster
# whose links mostly read like those, and hardly ever like fighting, is
# a crime or police incident: titled so and never promoted.
CRIME_SLUG = re.compile(
    r"\b(police|cops?|officers?|arrest(s|ed)?|court|trial|jury|judge|"
    r"convicted|guilty|sentenced|charged|suspects?|murder(s|ed|er)?|"
    r"stabb(ing|ed)|robbery|burglary|abduction|kidnapp(ing|ed)|assault(s|ed)?|"
    r"shooting|gunman|homicide|crash(es|ed)?|collision|accident|hit|"
    r"rider|driver|pedestrian|crime|extradition|manslaughter|domestic)\b"
)
WAR_SLUG = re.compile(
    r"\b(military|army|troops|soldiers|air ?strikes?|strikes?|missiles?|"
    r"drones?|rockets?|shelling|artillery|militants?|insurgents?|war|"
    r"(counter-?|ground |military |spring |summer )offensive|ceasefire|"
    r"frontline|idf|hamas|hezbollah|houthis?|"
    r"invasion|battle|bombing|bombs?|fighters)\b"
)
CRIME_MIN_LINKS = 3


def _url_words(url: str) -> str:
    path = urlsplit(url).path.lower().replace("_", "-")
    return " ".join(re.findall(r"[a-z]{3,}", path))


def crime_cluster(urls: list[str]) -> bool:
    """Most readable links are about crime, crashes or courts, and at
    most a third as many are about fighting."""
    crime = war = 0
    for url in urls:
        words = _url_words(url)
        if not words:
            continue
        is_war = bool(WAR_SLUG.search(words))
        war += is_war
        crime += bool(CRIME_SLUG.search(words)) and not is_war
    return crime >= CRIME_MIN_LINKS and crime >= 3 * war


# GDELT geocodes any article that mentions a place, then codes its lead
# sentence: a story about data-centre legislation in Nashville, or a
# victim testifying in an old case, becomes "violence in Nashville". An
# article whose link reads like neither violence nor unrest, or like a
# court or legislative story that isn't about war, is off topic and
# never joins (or starts) an event. Links with no readable words can't
# be judged and are kept.
VIOLENCE_SLUG = re.compile(
    r"\b(attack(s|ed|er|ers)?|kill(s|ed|ing|er)?|dead|deaths?|died|"
    r"shoot(s|ing|ings|er)?|shot|gun(s|man|men|fire)?|stab(s|bed|bing)?|"
    r"bomb(s|ed|ing|er)?|explosions?|blasts?|clash(es|ed)?|fight(s|ing)?|"
    r"wounded|injur(ed|ies|y)|hostages?|massacre|assault(s|ed)?|"
    r"murder(s|ed|er)?|homicides?|"
    r"violen(ce|t)|riot(s|ing)?|protest(s|ers|ed|ing)?|demonstrat\w*|"
    r"unrest|rally|rallies|march(es|ed)?|curfew|siege|raid(s|ed)?|"
    r"abduct\w*|kidnap\w*|lynch\w*|arson|torched|looting|terror\w*|"
    r"insurgen\w*|militan\w*|militias?|rebels?|coup|casualt\w*)\b"
)
COURT_SLUG = re.compile(
    r"\b(testif\w*|trial|court|courts|judge|jury|verdict|sentenc\w*|"
    r"lawsuit|sues|sued|appeal(s|ed)?|hearing|indict\w*|plea|pleads|"
    r"legislat\w*|lawmakers?|bill|bills|senate|congress|council|"
    r"committee|budget|election|campaign|ballot|anniversary|"
    r"years later|decade later|remember\w*|memorial|obituar\w*)\b"
)
TOPIC_MIN_WORDS = 3


def off_topic(url: str) -> bool:
    """The article's link is readable and isn't about violence or unrest
    happening now (court, legislative and memorial stories aren't,
    unless they're about war)."""
    words = _url_words(url)
    if len(words.split()) < TOPIC_MIN_WORDS:
        return False
    if WAR_SLUG.search(words):
        return False
    if COURT_SLUG.search(words):
        return True
    return not VIOLENCE_SLUG.search(words)


# Codes GDELT also uses for crime and accidents: an unconfirmed cluster
# of these is only "violence", not "military force" or "armed clash".
VAGUE_CODES = GENERIC_CODES | {"18", "180", "182", "19"}


def gdelt_title(top_code: str, place: str, status: str, crime: bool) -> str:
    if crime:
        label = "Crime or police incident"
    elif status != "active" and top_code in VAGUE_CODES:
        label = "Violence"
    else:
        label = label_for(top_code)
    return "{0} reported in {1}".format(label, place)[:300]


UPDATABLE_KINDS = {
    "quake",
    "fire_cluster",
    "hazard",
    "navwarn",
    "airspace",
    "wxalert",
    "outlook",
}


def new_event_id() -> str:
    return "E{0}".format(secrets.token_hex(5).upper())


def country_from_place(place: str) -> str:
    return place.rsplit(", ", 1)[-1].strip() if place else ""


def tidy_gdelt_place(place: str) -> str:
    """'Kyiv, Kyyiv, Misto, Ukraine' -> 'Kyiv, Ukraine'.

    GDELT names are 'City, ADM1, Country' with transliterated admin names;
    the city and country read better. ' (general)' suffixes are dropped.
    """
    parts = [p.replace(" (general)", "").strip() for p in place.split(",")]
    parts = [p for p in parts if p]
    if len(parts) <= 2:
        return ", ".join(parts)
    city, country = parts[0], parts[-1]
    # Keep US states: 'Chicago, Illinois, United States'.
    if country == "United States" and len(parts) >= 3:
        return "{0}, {1}".format(city, parts[1])
    return "{0}, {1}".format(city, country)


# --- storing raw records ---------------------------------------------------


async def store_raw(db: AsyncSession, records: list[RawIn]) -> list[RawRecord]:
    """Insert new records; update revisable ones. Returns rows to fuse."""
    if not records:
        return []
    by_source: dict[str, list[RawIn]] = {}
    for r in records:
        by_source.setdefault(r.source, []).append(r)
    changed: list[RawRecord] = []
    for source, items in by_source.items():
        # De-duplicate within the batch (GDELT repeats ids across files).
        unique = {r.external_id: r for r in items}
        existing = {
            row.external_id: row
            for row in (
                await db.execute(
                    select(RawRecord).where(
                        RawRecord.source == source,
                        RawRecord.external_id.in_(list(unique)),
                    )
                )
            ).scalars()
        }
        for ext_id, r in unique.items():
            row = existing.get(ext_id)
            if row is None:
                row = RawRecord(
                    source=r.source,
                    external_id=ext_id,
                    kind=r.kind,
                    observed_at=r.observed_at,
                    lat=r.lat,
                    lon=r.lon,
                    payload=r.payload,
                )
                db.add(row)
                changed.append(row)
            elif r.kind in UPDATABLE_KINDS and row.payload != r.payload:
                row.payload = r.payload
                row.observed_at = r.observed_at
                row.lat, row.lon = r.lat, r.lon
                row.fetched_at = utcnow()
                changed.append(row)
    await db.flush()
    return changed


# --- per-kind fusion ---------------------------------------------------------


def quake_severity(p: dict) -> int:
    mag = p.get("mag") or 0
    if mag >= 8:
        sev = 5
    elif mag >= 7:
        sev = 4
    elif mag >= 6:
        sev = 3
    elif mag >= 4.5:
        sev = 2
    else:
        sev = 1
    if p.get("alert") == "orange":
        sev = max(sev, 4)
    if p.get("alert") == "red":
        sev = 5
    if p.get("tsunami"):
        sev = max(sev, 3)
    return sev


def fire_severity(p: dict) -> int:
    n, frp = p.get("detections", 0), p.get("max_frp", 0)
    if n >= 200 or frp >= 1000:
        return 3
    if n >= 50 or frp >= 300:
        return 2
    return 1


GDELT_BASE = {"14": 1, "18": 2, "19": 3, "20": 4}
GDELT_STRONG = {"145": 2, "183": 3, "186": 3, "194": 4, "195": 4, "202": 4}


def gdelt_severity(code: str, root: str) -> int:
    for length in (4, 3):
        if code[:length] in GDELT_STRONG:
            return GDELT_STRONG[code[:length]]
    return GDELT_BASE.get(root, 1)


async def _upsert_keyed(
    db: AsyncSession, key: str, row: RawRecord, fields: dict
) -> Event:
    event = (
        await db.execute(select(Event).where(Event.key == key))
    ).scalar_one_or_none()
    if event is None:
        event = Event(
            id=new_event_id(),
            key=key,
            first_seen=row.observed_at,
            source_count=1,
            article_count=0,
            **fields,
        )
        db.add(event)
        await db.flush()
        db.add(EventSource(event_id=event.id, raw_record_id=row.id))
    else:
        for name, value in fields.items():
            setattr(event, name, value)
    return event


def _usgs_updated(p: dict) -> datetime | None:
    """USGS' own last-revision time (ms since the epoch)."""
    ms = p.get("updated")
    if not isinstance(ms, int | float):
        return None
    return datetime.fromtimestamp(ms / 1000, UTC)


async def fuse_quake(db: AsyncSession, row: RawRecord) -> Event:
    p = row.payload
    mag = p.get("mag")
    depth = p.get("depth_km")
    place = p.get("place") or "Unknown location"
    summary = "Magnitude {0} ({1}){2}. {3} solution from USGS.".format(
        "{0:.1f}".format(mag) if mag is not None else "?",
        p.get("mag_type") or "?",
        ", {0:.0f} km deep".format(depth) if depth is not None else "",
        "Reviewed" if p.get("status") == "reviewed" else "Automatic",
    )
    if p.get("tsunami"):
        summary += " A tsunami message has been issued; check NOAA / PTWC."
    return await _upsert_keyed(
        db,
        "usgs:{0}".format(row.external_id),
        row,
        {
            "type": "quake",
            "severity": quake_severity(p),
            "status": "active",
            "title": p.get("title") or "Earthquake",
            "summary": summary,
            "place": place[:200],
            "country": country_from_place(place)[:80],
            "lat": row.lat,
            "lon": row.lon,
            "last_updated": _usgs_updated(p) or row.observed_at,
            "confidence": 0.99 if p.get("status") == "reviewed" else 0.85,
            "data": {
                "mag": mag,
                "mag_type": p.get("mag_type"),
                "depth_km": depth,
                "alert": p.get("alert"),
                "tsunami": bool(p.get("tsunami")),
                "url": p.get("url"),
            },
        },
    )


async def fuse_fire(db: AsyncSession, row: RawRecord) -> Event:
    p = row.payload
    near = places.nearest(row.lat, row.lon, max_km=100)
    place = "near {0}".format(near.label()) if near else "remote area"
    return await _upsert_keyed(
        db,
        "firms:{0}".format(row.external_id),
        row,
        {
            "type": "fire",
            "severity": fire_severity(p),
            "status": "active",
            "title": "Thermal anomaly cluster, {0} detections".format(
                p.get("detections", 0)
            ),
            "summary": (
                "{0} satellite fire detections in one 0.25 degree cell on "
                "{1}. Peak radiative power {2} MW. Thermal anomalies are not "
                "always wildfires: flares and controlled burns show up too."
            ).format(p.get("detections"), p.get("date"), p.get("max_frp")),
            "place": place[:200],
            "country": near.country if near else "",
            "lat": row.lat,
            "lon": row.lon,
            "last_updated": row.observed_at,
            "confidence": 0.8,
            "data": dict(p),
        },
    )


def _domain(url: str) -> str:
    host = urlsplit(url or "").hostname or ""
    return host[4:] if host.startswith("www.") else host


# Word weights from the last review pass (story.Weights), used when new
# records pick a cluster between passes.
_weights = story.Weights()


def event_terms(event: Event) -> list[set[str]]:
    """The readable links of an event, as story terms."""
    out = []
    for url in (event.data or {}).get("urls") or []:
        terms = story.link_terms(url)
        if story.readable(terms):
            out.append(terms)
    return out


def pick_cluster(row: RawRecord, candidates: list[Event]) -> Event | None:
    """The nearby event a record joins: the one telling the same story
    (its link close to one of the event's), else the closest event that
    has no readable links to compare. A readable record that matches no
    story starts its own event. Unreadable links join the closest."""
    near = [
        (distance_km(row.lat, row.lon, e.lat, e.lon), e) for e in candidates
    ]
    near = sorted(
        ((d, e) for d, e in near if d <= CLUSTER_KM), key=lambda x: x[0]
    )
    if not near:
        return None
    terms = story.link_terms((row.payload or {}).get("url", ""))
    if not story.readable(terms):
        return near[0][1]
    best, best_score = None, 0.0
    blind = None
    for _, e in near:
        links = event_terms(e)
        if not links:
            blind = blind or e
            continue
        score = story.best_match(terms, links, _weights)
        if score >= story.SAME_STORY and score > best_score:
            best, best_score = e, score
    return best or blind


async def fuse_gdelt(db: AsyncSession, row: RawRecord) -> Event | None:
    p = row.payload
    # Only lead-paragraph ("root") events; the rest are background
    # mentions and are GDELT's biggest source of false positives.
    if not p.get("root_event", True):
        return None
    if off_topic(p.get("url", "")):
        return None
    kind = p["type"]
    dlat, dlon = degrees_box(row.lat, CLUSTER_KM)
    candidates = (
        await db.execute(
            select(Event).where(
                and_(
                    Event.type == kind,
                    Event.key.is_(None),
                    Event.status != "expired",
                    Event.lat.between(row.lat - dlat, row.lat + dlat),
                    Event.lon.between(row.lon - dlon, row.lon + dlon),
                    Event.last_updated >= row.observed_at - CLUSTER_WINDOW,
                )
            )
        )
    ).scalars()
    event = pick_cluster(row, list(candidates))
    domain = _domain(p.get("url", ""))
    sev = gdelt_severity(p.get("code", ""), p.get("root", ""))
    if event is None:
        event = Event(
            id=new_event_id(),
            key=None,
            type=kind,
            severity=sev,
            status="candidate",
            title="",
            place=tidy_gdelt_place(p.get("place", ""))[:200],
            country=country_from_place(p.get("place", "")).replace(
                " (general)", ""
            )[:80],
            lat=row.lat,
            lon=row.lon,
            first_seen=row.observed_at,
            last_updated=row.observed_at,
            confidence=0.3,
            source_count=0,
            article_count=0,
            data={"codes": {}, "outlets": [], "urls": [], "actors": []},
        )
        db.add(event)
        await db.flush()
    data = event.data or {}
    codes = Counter(data.get("codes", {}))
    codes[p.get("code", "")] += 1
    outlets = list(dict.fromkeys(data.get("outlets", []) + [domain]))
    urls = list(dict.fromkeys(data.get("urls", []) + [p.get("url", "")]))
    actors = [a for a in data.get("actors", [])]
    for actor in (p.get("actor1"), p.get("actor2")):
        if actor and actor not in actors:
            actors.append(actor)
    articles = event.article_count + max(1, int(p.get("articles") or 1))

    code_outlets = {
        c: list(v) for c, v in (data.get("code_outlets") or {}).items()
    }
    this_code = p.get("code", "")
    if domain and domain not in code_outlets.setdefault(this_code, []):
        code_outlets[this_code].append(domain)

    # The label is what most outlets agree on, not the most alarming code
    # anyone used: a cluster of political stories with one "fight with
    # artillery" coding must not be called artillery fighting.
    top_code = max(
        codes,
        key=lambda c: (
            len(code_outlets.get(c, [])),
            codes[c],
            gdelt_severity(c, c[:2]),
        ),
    )
    severity = gdelt_severity(top_code, top_code[:2])
    if articles >= 30:
        severity = min(4, severity + 1)
    # Eligible for promotion when enough outlets report the same kind of
    # event (same CAMEO root). review_gdelt() then also asks the news feeds.
    root_outlets = {
        o
        for c, os_ in code_outlets.items()
        if c[:2] == top_code[:2]
        for o in os_
    }
    root_articles = sum(n for c, n in codes.items() if c[:2] == top_code[:2])
    generic_only = set(codes) <= GENERIC_CODES
    needed = PROMOTE_ARTICLES_GENERIC if generic_only else PROMOTE_ARTICLES
    eligible = len(root_outlets) >= PROMOTE_OUTLETS and (
        articles >= needed and root_articles >= PROMOTE_OUTLETS
    )
    status = event.status
    place = event.place or p.get("place", "")
    crime = top_code[:2] in ("18", "19", "20") and crime_cluster(urls)
    if crime:
        eligible = False
        severity = 1
    event.title = gdelt_title(top_code, place, status, crime)
    event.summary = (
        "Machine-coded by GDELT from {0} articles across {1} outlets. "
        "Single reports can be wrong; open the sources to check."
    ).format(articles, len([o for o in outlets if o]))
    event.severity = severity
    event.status = status
    event.article_count = articles
    event.source_count = len([o for o in outlets if o])
    event.confidence = round(min(0.9, 0.25 + 0.1 * event.source_count), 2)
    event.last_updated = max(event.last_updated, row.observed_at)
    event.data = {
        "codes": dict(codes),
        "code_outlets": {c: v[:50] for c, v in code_outlets.items()},
        "outlets": outlets[:50],
        "urls": [u for u in urls if u][:50],
        "actors": actors[:20],
        "eligible": eligible,
        "crime": crime,
        "corroboration": data.get("corroboration", []),
    }
    db.add(EventSource(event_id=event.id, raw_record_id=row.id))
    return event


async def store_article(db: AsyncSession, row: RawRecord) -> None:
    p = row.payload
    exists = (
        await db.execute(select(Article.id).where(Article.url == p["url"]))
    ).first()
    if exists:
        return
    db.add(
        Article(
            outlet=p["outlet"][:80],
            url=p["url"],
            title=p["title"],
            summary=p.get("summary", ""),
            published_at=row.observed_at,
        )
    )


async def fuse_hazard(db: AsyncSession, row: RawRecord) -> Event:
    """GDACS, EONET and tsunami bulletins: one event per hazard."""
    p = row.payload
    hazard = p.get("hazard", "")
    near = places.nearest(row.lat, row.lon, max_km=150)
    place = near.label() if near else (p.get("country") or "")
    title = p.get("title") or HAZARD_LABELS.get(hazard, "Hazard")
    summary = " ".join(
        str(p.get("summary") or "").replace("<br/>", " ").split()
    )[:600]
    return await _upsert_keyed(
        db,
        "{0}:{1}".format(row.source, row.external_id),
        row,
        {
            "type": "hazard",
            "severity": max(1, min(5, int(p.get("severity") or 1))),
            "status": "active",
            "title": title[:300],
            "summary": summary
            or "{0} reported by {1}.".format(
                HAZARD_LABELS.get(hazard, "Hazard"), p.get("provider")
            ),
            "place": (place or "")[:200],
            "country": (p.get("country") or (near.country if near else ""))[
                :80
            ],
            "lat": row.lat,
            "lon": row.lon,
            "last_updated": row.observed_at,
            "confidence": 0.95,
            "data": {
                "hazard": hazard,
                "label": HAZARD_LABELS.get(hazard, hazard),
                "provider": p.get("provider"),
                "alert": p.get("alert"),
                "knots": p.get("knots"),
                "track": p.get("track"),
                "from": p.get("from"),
                "to": p.get("to"),
                "url": p.get("url"),
            },
        },
    )


async def fuse_navwarn(db: AsyncSession, row: RawRecord) -> Event:
    p = row.payload
    return await _upsert_keyed(
        db,
        "nga:{0}".format(row.external_id),
        row,
        {
            "type": "maritime",
            "severity": int(p.get("severity") or 1),
            "status": "active",
            "title": "{0}: {1}".format(p.get("id"), p.get("title"))[:300],
            "summary": " ".join(str(p.get("text") or "").split())[:600],
            "place": (p.get("area") or "")[:200],
            "country": "",
            "lat": row.lat,
            "lon": row.lon,
            "last_updated": row.observed_at,
            "confidence": 0.99,
            "data": {
                "area": p.get("area"),
                "issued": p.get("issued"),
                "authority": p.get("authority"),
                "points": p.get("points"),
                "url": "https://msi.nga.mil/NavWarnings",
            },
        },
    )


FUSERS = {
    "quake": fuse_quake,
    "fire_cluster": fuse_fire,
    "gdelt": fuse_gdelt,
    "hazard": fuse_hazard,
    "navwarn": fuse_navwarn,
}


# --- GDELT corroboration ---------------------------------------------------

# GDELT pins national political coverage on these places, so "fighting at
# the White House" is usually a story about a political fight.
SEAT_OF_GOVERNMENT = (
    "white house",
    "capitol",
    "pentagon",
    "kremlin",
    "downing street",
    "westminster",
    "elysee",
    "élysée",
    "zhongnanhai",
    "blue house",
)
CONFLICT_WORDS = re.compile(
    r"\b(attack(s|ed)?|air ?strikes?|strikes?|shell(s|ed|ing)|missiles?|"
    r"drones?|rockets?|fighting|clash(es|ed)?|killed|troops|"
    r"(counter-?|ground |military )offensive|"
    r"bomb(s|ed|ing)?|artillery|militants?|insurgents?|war|invasion|"
    r"ceasefire|frontline|front line|raid(s|ed)?)\b",
    re.IGNORECASE,
)
UNREST_WORDS = re.compile(
    r"\b(protest(s|ers|ed|ing)?|demonstrat(ion|ions|ors|ed)|rall(y|ies)|"
    r"march(es|ed)?|riot(s|ing|ers)?|unrest|walkout|strike|strikers)\b",
    re.IGNORECASE,
)
CORROBORATION_WINDOW = timedelta(hours=24)
# How close a headline must be to one of the event's links.
HEADLINE_MATCH = 0.3
REVIEW_HOURS = 48


def seat_of_government(place: str) -> bool:
    lowered = (place or "").lower()
    return any(name in lowered for name in SEAT_OF_GOVERNMENT)


def _place_terms(event: Event) -> list[str]:
    """The city for a city-level event; the country only when the event
    is placed at country level (a country name alone backs anything)."""
    parts = [p.strip() for p in (event.place or "").split(",") if p.strip()]
    if len(parts) >= 2 and len(parts[0]) >= 4:
        return [parts[0]]
    if event.country and len(event.country) >= 4:
        return [event.country]
    return []


async def corroborating_articles(
    db: AsyncSession, event: Event
) -> list[Article]:
    """Headlines from the news feeds that back a GDELT event: they name
    its city (or, for a country-level event, the country) in the headline
    or summary, and the headline itself uses words for that kind of event
    and names the place or its country.

    Seat-of-government places need the place itself in the headline.
    """
    words = CONFLICT_WORDS if event.type == "conflict" else UNREST_WORDS
    strict = seat_of_government(event.place)
    terms = _place_terms(event)
    if not terms:
        return []
    conditions = []
    for term in terms:
        like = "%{0}%".format(term.replace("%", "").replace("_", ""))
        conditions.append(Article.title.ilike(like))
        if not strict:
            conditions.append(Article.summary.ilike(like))
    rows = await db.execute(
        select(Article)
        .where(
            Article.published_at >= event.first_seen - CORROBORATION_WINDOW,
            Article.published_at
            <= event.last_updated + CORROBORATION_WINDOW / 2,
            or_(*conditions),
        )
        .order_by(Article.published_at.desc())
        .limit(50)
    )
    # The headline itself must say what happened and where: the place,
    # or at least the event's country, in the title (a briefing that
    # mentions Gaza in passing under "strikes on Iran" isn't about Gaza).
    names = [t.lower() for t in terms]
    if event.country and len(event.country) >= 4:
        names.append(event.country.lower())

    def about(a: Article) -> bool:
        title = a.title.lower()
        if opinion(a.title):
            return False
        return bool(words.search(a.title)) and any(n in title for n in names)

    found = [a for a in rows.scalars() if about(a)]
    # The headline must tell the same story as the event's own links
    # (a Gaza headline about aid talks doesn't back fighting in Gaza);
    # best match first, so two events in one city don't share one. An
    # event with no readable links can't be compared and keeps the
    # place-and-words rule.
    links = event_terms(event)
    if not links:
        return found
    scored = [
        (story.best_match(story.title_terms(a.title), links, _weights), a)
        for a in found
    ]
    scored = [x for x in scored if x[0] >= HEADLINE_MATCH]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [a for _, a in scored]


# Opinion, analysis and question headlines say what someone thinks, not
# that something happened: they never corroborate an event.
OPINION = re.compile(
    r"^(opinion|analysis|comment|editorial|explainer|think|why|how|what|"
    r"who|is|are|can|should|will|letters?)\b|\?\s*$|\?\s",
    re.IGNORECASE,
)


def opinion(title: str) -> bool:
    return bool(OPINION.search((title or "").strip()))


def headline_title(title: str) -> str:
    """A news headline as an event title: the outlet's " - Name" or
    " | Name" tail removed."""
    t = re.sub(
        r"\s+[-|–]\s+[^-|–]{2,40}$", "", " ".join((title or "").split())
    )
    return t[:200]


def tally(records: list[RawRecord]) -> dict:
    """An event's GDELT picture rebuilt from its records, the same way
    fuse_gdelt builds it one record at a time."""
    codes: Counter = Counter()
    code_outlets: dict[str, list[str]] = {}
    outlets: list[str] = []
    urls: list[str] = []
    actors: list[str] = []
    articles = 0
    for r in sorted(records, key=lambda x: x.observed_at):
        p = r.payload or {}
        code = p.get("code", "")
        domain = _domain(p.get("url", ""))
        codes[code] += 1
        if domain and domain not in code_outlets.setdefault(code, []):
            code_outlets[code].append(domain)
        if domain and domain not in outlets:
            outlets.append(domain)
        if p.get("url") and p["url"] not in urls:
            urls.append(p["url"])
        for actor in (p.get("actor1"), p.get("actor2")):
            if actor and actor not in actors:
                actors.append(actor)
        articles += max(1, int(p.get("articles") or 1))
    return {
        "codes": codes,
        "code_outlets": code_outlets,
        "outlets": outlets,
        "urls": urls,
        "actors": actors,
        "articles": articles,
    }


def judge(t: dict) -> dict:
    """Label, severity and promotion eligibility from a tally."""
    codes, code_outlets = t["codes"], t["code_outlets"]
    top = max(
        codes,
        key=lambda c: (
            len(code_outlets.get(c, [])),
            codes[c],
            gdelt_severity(c, c[:2]),
        ),
    )
    severity = gdelt_severity(top, top[:2])
    if t["articles"] >= 30:
        severity = min(4, severity + 1)
    root_outlets = {
        o for c, os_ in code_outlets.items() if c[:2] == top[:2] for o in os_
    }
    root_articles = sum(n for c, n in codes.items() if c[:2] == top[:2])
    needed = (
        PROMOTE_ARTICLES_GENERIC
        if set(codes) <= GENERIC_CODES
        else PROMOTE_ARTICLES
    )
    eligible = len(root_outlets) >= PROMOTE_OUTLETS and (
        t["articles"] >= needed and root_articles >= PROMOTE_OUTLETS
    )
    crime = top[:2] in ("18", "19", "20") and crime_cluster(t["urls"])
    if crime:
        eligible, severity = False, 1
    return {
        "top": top,
        "severity": severity,
        "eligible": eligible,
        "crime": crime,
    }


async def prune_strays(db: AsyncSession, event: Event) -> bool:
    """Take off-topic articles out of an event (they joined before the
    topic check) and rebuild its counts. Returns False when nothing is
    left, after retiring the event."""
    if not any(off_topic(u) for u in (event.data or {}).get("urls") or []):
        return True
    records = list(
        (
            await db.execute(
                select(RawRecord)
                .join(EventSource, EventSource.raw_record_id == RawRecord.id)
                .where(
                    EventSource.event_id == event.id,
                    RawRecord.source == "gdelt",
                )
            )
        ).scalars()
    )
    stray = [r for r in records if off_topic((r.payload or {}).get("url", ""))]
    kept = [r for r in records if r not in stray]
    if stray:
        await db.execute(
            delete(EventSource).where(
                EventSource.event_id == event.id,
                EventSource.raw_record_id.in_([r.id for r in stray]),
            )
        )
    if not kept:
        event.status = "expired"
        return False
    _apply_tally(event, tally(kept))
    return True


def _apply_tally(event: Event, t: dict) -> None:
    j = judge(t)
    data = dict(event.data or {})
    data.update(
        codes=dict(t["codes"]),
        code_outlets={c: v[:50] for c, v in t["code_outlets"].items()},
        outlets=t["outlets"][:50],
        urls=t["urls"][:50],
        actors=t["actors"][:20],
        eligible=j["eligible"],
        crime=j["crime"],
    )
    event.data = data
    event.severity = j["severity"]
    event.article_count = t["articles"]
    event.source_count = len(t["outlets"])
    event.confidence = round(min(0.9, 0.25 + 0.1 * event.source_count), 2)


# --- where an event's articles say it is ----------------------------------
#
# GDELT places an event from the actors and places in an article, so a
# story about Russian strikes on Kyiv can land in Moscow. The article
# links say where the story is: when most readable links name another
# city and hardly any name the event's own, the event moves there.

# Cities whose names are also everyday English words in links.
PLACE_STOPWORDS = {
    "nice", "mobile", "reading", "split", "bath", "sale", "orange",
    "victoria", "independence", "enterprise", "spring", "union",
    "federal", "capital", "central", "mission", "pride", "hope",
    "liberty", "march", "cork", "most", "bury", "deal", "wells",
}  # fmt: skip
CITY_MIN_POP = 200_000
MOVE_MIN_LINKS = 3
MOVE_SHARE = 0.4
OWN_MAX_SHARE = 0.15


@lru_cache(maxsize=1)
def gazetteer() -> dict[str, places.Place]:
    """Folded city names (200,000+ people) to their place: the largest
    city wins a shared name."""
    out: dict[str, places.Place] = {}
    for p in places.load():
        if (
            p.population < CITY_MIN_POP
            or not p.key
            or p.key in PLACE_STOPWORDS
        ):
            continue
        if len(p.key) < 4:
            continue
        cur = out.get(p.key)
        if cur is None or p.population > cur.population:
            out[p.key] = p
    return out


def cities_named(url: str) -> set[str]:
    """Folded names of the big cities a link's words mention."""
    words = _url_words(url).split()
    names = gazetteer()
    found = set()
    for n in (3, 2, 1):
        for i in range(len(words) - n + 1):
            key = " ".join(words[i : i + n])
            if key in names:
                found.add(key)
    return found


def better_place(event: Event, urls: list[str]) -> places.Place | None:
    """Where the event's links say it is, when that's clearly somewhere
    other than its own city; else None."""
    readable = [
        u for u in urls if len(_url_words(u).split()) >= TOPIC_MIN_WORDS
    ]
    if len(readable) < MOVE_MIN_LINKS:
        return None
    own = places.fold((event.place or "").split(",")[0])
    counts: Counter = Counter()
    own_hits = 0
    for u in readable:
        named = cities_named(u)
        own_hits += own in named
        counts.update(named - {own})
    if not counts:
        return None
    best, n = counts.most_common(1)[0]
    if n < MOVE_MIN_LINKS or n < MOVE_SHARE * len(readable):
        return None
    if own_hits > OWN_MAX_SHARE * len(readable):
        return None
    return gazetteer()[best]


async def relocate(db: AsyncSession, event: Event) -> Event | None:
    """Move a misplaced event to where its links say, merging it into an
    event of the same kind already there. Returns the event that now
    holds it (this one, or the one it merged into), or None."""
    target = better_place(event, (event.data or {}).get("urls") or [])
    if target is None:
        return None
    dlat, dlon = degrees_box(target.lat, CLUSTER_KM)
    near = (
        (
            await db.execute(
                select(Event).where(
                    Event.id != event.id,
                    Event.type == event.type,
                    Event.key.is_(None),
                    Event.status != "expired",
                    Event.lat.between(target.lat - dlat, target.lat + dlat),
                    Event.lon.between(target.lon - dlon, target.lon + dlon),
                    Event.last_updated
                    >= utcnow() - timedelta(hours=REVIEW_HOURS),
                )
            )
        )
        .scalars()
        .first()
    )
    old_place = event.place
    if near is not None:
        await merge_into(db, event, near)
        return near
    event.place = "{0}, {1}".format(target.name, target.country)[:200]
    event.country = target.country[:80]
    event.lat, event.lon = round(target.lat, 4), round(target.lon, 4)
    event.data = dict(event.data or {}) | {"moved_from": old_place}
    return event


async def merge_into(db: AsyncSession, event: Event, near: Event) -> None:
    """Move an event's records into another and retire it."""
    linked = set(
        (
            await db.execute(
                select(EventSource.raw_record_id).where(
                    EventSource.event_id == near.id
                )
            )
        ).scalars()
    )
    mine = list(
        (
            await db.execute(
                select(EventSource.raw_record_id).where(
                    EventSource.event_id == event.id
                )
            )
        ).scalars()
    )
    for rid in mine:
        if rid not in linked:
            db.add(EventSource(event_id=near.id, raw_record_id=rid))
    await db.execute(
        delete(EventSource).where(EventSource.event_id == event.id)
    )
    await db.flush()
    records = list(
        (
            await db.execute(
                select(RawRecord)
                .join(EventSource, EventSource.raw_record_id == RawRecord.id)
                .where(
                    EventSource.event_id == near.id,
                    RawRecord.source == "gdelt",
                )
            )
        ).scalars()
    )
    if records:
        _apply_tally(near, tally(records))
    near.first_seen = min(near.first_seen, event.first_seen)
    near.last_updated = max(near.last_updated, event.last_updated)
    event.status = "expired"
    event.data = dict(event.data or {}) | {"merged_into": near.id}


MERGE_KM = 50


async def merge_duplicates(db: AsyncSession, events: list[Event]) -> set[str]:
    """Events of one kind, close together, backed by a same headline are
    one story whose outlets worded it differently ("tallest skyscraper",
    "financial district tower"): merge each into the bigger."""
    backed = [
        e
        for e in events
        if e.status == "active" and (e.data or {}).get("corroboration")
    ]
    backed.sort(key=lambda e: e.article_count)
    changed: set[str] = set()
    for i, e in enumerate(backed):
        ids = set(e.data["corroboration"])
        for keeper in reversed(backed[i + 1 :]):
            if keeper.status == "expired" or keeper.type != e.type:
                continue
            if not ids & set(keeper.data.get("corroboration") or []):
                continue
            if distance_km(e.lat, e.lon, keeper.lat, keeper.lon) > MERGE_KM:
                continue
            await merge_into(db, e, keeper)
            keeper.data = dict(keeper.data) | {
                "corroboration": list(
                    dict.fromkeys(keeper.data["corroboration"] + list(ids))
                )[:5]
            }
            changed.update({e.id, keeper.id})
            break
    return changed


# --- one story per event ----------------------------------------------------
#
# GDELT clusters by place and time, and files an article once for every
# place it mentions. So: each article belongs to one event, each event
# keeps one story (the others are filed again on their own), and events
# telling the same story merge.

WEIGHT_HOURS = 72
# Share of an event's links matching another's for them to merge.
MERGE_STORY = 0.5
# Words in more than this share of the day's articles don't make two
# events worth comparing.
COMMON_SHARE = 0.05


def _url(r: RawRecord) -> str:
    return (r.payload or {}).get("url") or ""


async def gdelt_records(
    db: AsyncSession, event_ids: list[str]
) -> dict[str, list[RawRecord]]:
    out: dict[str, list[RawRecord]] = {i: [] for i in event_ids}
    for i in range(0, len(event_ids), 500):
        rows = await db.execute(
            select(EventSource.event_id, RawRecord)
            .join(RawRecord, RawRecord.id == EventSource.raw_record_id)
            .where(
                EventSource.event_id.in_(event_ids[i : i + 500]),
                RawRecord.source == "gdelt",
            )
        )
        for event_id, record in rows:
            out[event_id].append(record)
    return out


async def review_weights(
    db: AsyncSession, records: dict[str, list[RawRecord]]
) -> story.Weights:
    """Word weights from the links under review and recent headlines."""
    urls = {_url(r) for rs in records.values() for r in rs}
    weights = story.Weights(story.link_terms(u) for u in urls if u)
    titles = await db.execute(
        select(Article.title).where(
            Article.published_at >= utcnow() - timedelta(hours=WEIGHT_HOURS)
        )
    )
    for (title,) in titles:
        weights.add(story.title_terms(title))
    return weights


def names_own_place(event: Event, url: str) -> bool:
    own = places.fold((event.place or "").split(",")[0])
    if len(own) < 4:
        return False
    return " {0} ".format(own) in " {0} ".format(
        places.fold(story.link_text(url))
    )


async def _drop_records(
    db: AsyncSession, event: Event, drop: list[RawRecord], kept: list
) -> bool:
    """Unlink records from an event and recount it; retire it when none
    are left. Returns whether it survives."""
    await db.execute(
        delete(EventSource).where(
            EventSource.event_id == event.id,
            EventSource.raw_record_id.in_([r.id for r in drop]),
        )
    )
    if not kept:
        event.status = "expired"
        event.data = dict(event.data or {}) | {"retired": "story"}
        return False
    _apply_tally(event, tally(kept))
    return True


async def claim_links(
    db: AsyncSession,
    events: list[Event],
    records: dict[str, list[RawRecord]],
    weights: story.Weights,
) -> set[str]:
    """An article filed under several events stays with one: the event
    whose city its link names, else the one whose other links it fits
    best, else the biggest."""
    holders: dict[str, dict[str, Event]] = {}
    for e in events:
        for r in records.get(e.id, []):
            if _url(r):
                holders.setdefault(_url(r), {})[e.id] = e
    drop: dict[str, set[str]] = {}
    for url, evs in holders.items():
        if len(evs) < 2:
            continue
        terms = story.link_terms(url)

        def fit(e: Event, url: str = url, terms: set = terms) -> tuple:
            others = [
                story.link_terms(_url(r))
                for r in records.get(e.id, [])
                if _url(r) != url
            ]
            others = [t for t in others if story.readable(t)]
            match = (
                story.best_match(terms, others, weights)
                if story.readable(terms)
                else 0.0
            )
            return (names_own_place(e, url), match, e.article_count)

        keeper = max(evs.values(), key=fit)
        for e in evs.values():
            if e is not keeper:
                drop.setdefault(e.id, set()).add(url)
    changed: set[str] = set()
    by_id = {e.id: e for e in events}
    for event_id, urls in drop.items():
        event = by_id[event_id]
        recs = records.get(event_id, [])
        gone = [r for r in recs if _url(r) in urls]
        kept = [r for r in recs if _url(r) not in urls]
        await _drop_records(db, event, gone, kept)
        records[event_id] = kept
        changed.add(event_id)
    return changed


async def split_stories(
    db: AsyncSession, event: Event, weights: story.Weights
) -> list[RawRecord]:
    """Keep an event's main story (the one most outlets tell) and take
    the other stories' records out, to be filed again on their own.
    Unreadable links stay."""
    records = (await gdelt_records(db, [event.id]))[event.id]
    readable = []
    for r in records:
        terms = story.link_terms(_url(r))
        if story.readable(terms):
            readable.append((r, terms))
    if len(readable) < 2:
        return []
    # The headlines backing the event join the stories they match, so
    # outlets wording one story differently stay together.
    bridges = []
    ids = (event.data or {}).get("corroboration") or []
    if ids:
        titles = await db.execute(
            select(Article.title).where(Article.id.in_(ids))
        )
        bridges = [story.title_terms(t) for (t,) in titles]
    groups = story.clusters([t for _, t in readable] + bridges, weights)
    groups = [[i for i in g if i < len(readable)] for g in groups]
    groups = [g for g in groups if g]
    if len(groups) < 2:
        return []

    def strength(group: list[int]) -> tuple:
        recs = [readable[i][0] for i in group]
        outlets = {_domain(_url(r)) for r in recs}
        articles = sum(
            max(1, int((r.payload or {}).get("articles") or 1)) for r in recs
        )
        return (len(outlets), articles)

    main = max(groups, key=strength)
    out = [readable[i][0] for g in groups if g is not main for i in g]
    kept = [r for r in records if r not in out]
    await _drop_records(db, event, out, kept)
    return out


def _supported(event: Event) -> bool:
    """The event's links name its own city (or can't be read)."""
    urls = [
        u
        for u in (event.data or {}).get("urls") or []
        if story.readable(story.link_terms(u))
    ]
    if not urls:
        return True
    hits = sum(names_own_place(event, u) for u in urls)
    return hits > OWN_MAX_SHARE * len(urls)


def _names_place(event: Event, other: Event) -> bool:
    """The event's links name the other event's city often enough."""
    urls = [
        u
        for u in (event.data or {}).get("urls") or []
        if story.readable(story.link_terms(u))
    ]
    hits = sum(names_own_place(other, u) for u in urls)
    return bool(urls) and hits > OWN_MAX_SHARE * len(urls)


async def merge_stories(
    db: AsyncSession, events: list[Event], weights: story.Weights
) -> set[str]:
    """Events of one kind telling the same story merge into the bigger:
    when they're within MERGE_KM, or when the smaller one's links don't
    name its own city but name the bigger one's (GDELT placed it on an
    actor's capital or a passing mention)."""
    live = [e for e in events if e.status != "expired"]
    terms = {e.id: event_terms(e) for e in live}
    common = max(3, COMMON_SHARE * weights.n)
    rare = {
        e.id: {
            t
            for ts in terms[e.id]
            for t in ts
            if weights.df.get(t, 0) <= common
        }
        for e in live
    }
    supported = {e.id: _supported(e) for e in live}
    changed: set[str] = set()
    live.sort(key=lambda e: e.article_count)
    for i, e in enumerate(live):
        if e.status == "expired" or not terms[e.id]:
            continue
        best, best_share = None, 0.0
        for t in live[i + 1 :]:
            if t.status == "expired" or t.type != e.type:
                continue
            if not rare[e.id] & rare[t.id]:
                continue
            close = distance_km(e.lat, e.lon, t.lat, t.lon) <= MERGE_KM
            if not close and (supported[e.id] or not _names_place(e, t)):
                continue
            share = story.shared_story(terms[e.id], terms[t.id], weights)
            if share >= MERGE_STORY and share > best_share:
                best, best_share = t, share
        if best is None:
            continue
        await merge_into(db, e, best)
        terms[best.id] = event_terms(best)
        rare[best.id] |= rare[e.id]
        changed.update({e.id, best.id})
    return changed


async def refile(
    db: AsyncSession, detached: list[RawRecord], events: list[Event]
) -> list[Event]:
    """File records taken out of an event on their own (joining an event
    telling their story nearby, or starting one), unless another event
    already holds the article. Returns the events that took them."""
    if not detached:
        return []
    live = [e.id for e in events if e.status != "expired"]
    held = {
        _url(r) for rs in (await gdelt_records(db, live)).values() for r in rs
    }
    out: dict[str, Event] = {}
    for r in detached:
        if _url(r) in held:
            continue
        event = await fuse_gdelt(db, r)
        await db.flush()
        if event is not None:
            out[event.id] = event
        held.add(_url(r))
    return list(out.values())


async def review_gdelt(db: AsyncSession) -> set[str]:
    """Clean up recent GDELT events, then promote or demote them.

    First each event is made one story in one place: every article in one
    event, off-topic articles out, other stories filed on their own,
    misplaced events moved, events telling the same story merged.

    Then active needs both: enough outlets reporting the same kind of
    event ("eligible"), and corroboration from the news feeds, one
    headline telling the same story, or two from different outlets for
    seat-of-government places. Events that lose either go back to
    unconfirmed.
    """
    since = utcnow() - timedelta(hours=REVIEW_HOURS)
    rows = list(
        (
            await db.execute(
                select(Event).where(
                    Event.key.is_(None),
                    Event.type.in_(("conflict", "unrest")),
                    Event.status != "expired",
                    Event.last_updated >= since,
                )
            )
        ).scalars()
    )
    changed: set[str] = set()
    global _weights
    records = await gdelt_records(db, [e.id for e in rows])
    weights = _weights = await review_weights(db, records)

    def live() -> list[Event]:
        return [e for e in rows if e.status != "expired"]

    def adopt(events: list[Event]) -> None:
        known = {e.id for e in rows}
        for e in events:
            changed.add(e.id)
            if e.id not in known:
                rows.append(e)

    # 1. Each article in one event only.
    changed |= await claim_links(db, rows, records, weights)
    await db.flush()
    # 2. Off-topic articles out (an event left with none is retired),
    # and one story per event, the others filed on their own.
    detached: list[RawRecord] = []
    for event in live():
        before = event.article_count
        if not await prune_strays(db, event):
            changed.add(event.id)
            continue
        if event.article_count != before:
            changed.add(event.id)
        split = await split_stories(db, event, weights)
        if split:
            detached += split
            changed.add(event.id)
    await db.flush()
    adopt(await refile(db, detached, rows))
    # 3. Misplaced events (Kyiv strikes pinned on Moscow) move, or merge
    # into an event there; events telling the same story merge.
    for event in live():
        holder = await relocate(db, event)
        if holder is not None:
            changed.update({event.id, holder.id})
    await db.flush()
    merged = await merge_stories(db, live(), weights)
    changed |= merged
    await db.flush()
    # A merge brings all of an event's records: keep one story.
    detached = []
    for event in live():
        if event.id in merged:
            detached += await split_stories(db, event, weights)
    await db.flush()
    adopt(await refile(db, detached, rows))
    # 4. Confirm or not, and title.
    for event in live():
        if await judge_event(db, event):
            changed.add(event.id)
    await db.flush()
    # One story split into clusters backed by the same headline.
    changed |= await merge_duplicates(db, live())
    return changed


async def judge_event(db: AsyncSession, event: Event) -> bool:
    """Set an event's status, title and backing headlines. Returns
    whether anything changed."""
    changed = False
    data = dict(event.data or {})
    # Clusters fused before the crime check, or that turned into one.
    codes = data.get("codes") or {}
    top = max(codes, key=codes.get) if codes else ""
    is_crime = top[:2] in ("18", "19", "20") and crime_cluster(
        data.get("urls") or []
    )
    if is_crime and not data.get("crime"):
        data.update(crime=True, eligible=False)
        event.severity = 1
        event.data = data
        changed = True
    backing = []
    if data.get("eligible"):
        backing = await corroborating_articles(db, event)
    needed = 2 if seat_of_government(event.place) else 1
    outlets = {a.outlet for a in backing}
    corroborated = len(outlets) >= needed
    status = "active" if data.get("eligible") and corroborated else "candidate"
    title = gdelt_title(
        top, event.place or "", status, bool(data.get("crime"))
    )
    # A confirmed event reads as the news says it, not as GDELT's code:
    # the headline that backs it.
    if status == "active" and backing:
        title = headline_title(backing[0].title) or title
    if top and title != event.title:
        event.title = title
        changed = True
    ids = [a.id for a in backing[:5]]
    if status != event.status or ids != data.get("corroboration", []):
        data["corroboration"] = ids
        event.data = data
        event.status = status
        if corroborated:
            event.summary = (
                "Machine-coded by GDELT from {0} articles across {1} "
                "outlets, and backed by {2} headline{3} from your news "
                "feeds."
            ).format(
                event.article_count,
                event.source_count,
                len(backing),
                "" if len(backing) == 1 else "s",
            )
        changed = True
    return changed


async def fuse(db: AsyncSession, rows: list[RawRecord]) -> set[str]:
    """Fuse rows into events. Returns ids of events that changed."""
    changed: set[str] = set()
    for row in rows:
        if row.kind == "article":
            await store_article(db, row)
            continue
        fuser = FUSERS.get(row.kind)
        if fuser is None or row.lat is None or row.lon is None:
            continue
        event = await fuser(db, row)
        if event is None:
            continue
        await db.flush()
        changed.add(event.id)
    # New GDELT reports or new headlines can change what's corroborated.
    if any(r.kind in ("gdelt", "article") for r in rows):
        await db.flush()
        changed |= await review_gdelt(db)
    return changed


# --- housekeeping -----------------------------------------------------------


async def expire_and_prune(
    db: AsyncSession, raw_days: int, event_days: int
) -> int:
    """Expire stale events and delete old data. Returns events expired."""
    now = utcnow()
    expired = 0
    for kind in ("quake", "fire", "conflict", "unrest"):
        window = ACTIVE_WINDOW.get(kind, DEFAULT_ACTIVE_WINDOW)
        result = await db.execute(
            update(Event)
            .where(
                Event.type == kind,
                Event.status != "expired",
                Event.last_updated < now - window,
            )
            .values(status="expired")
        )
        expired += result.rowcount or 0
    await db.execute(
        delete(RawRecord).where(
            RawRecord.observed_at < now - timedelta(days=raw_days)
        )
    )
    await db.execute(
        delete(Event).where(
            Event.status == "expired",
            Event.last_updated < now - timedelta(days=event_days),
        )
    )
    await db.execute(
        delete(Article).where(
            Article.published_at < now - timedelta(days=raw_days)
        )
    )
    return expired
