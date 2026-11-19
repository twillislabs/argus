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
from urllib.parse import urlsplit

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from argus import places
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

UPDATABLE_KINDS = {"quake", "fire_cluster", "hazard", "navwarn"}


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


async def fuse_gdelt(db: AsyncSession, row: RawRecord) -> Event | None:
    p = row.payload
    # Only lead-paragraph ("root") events; the rest are background
    # mentions and are GDELT's biggest source of false positives.
    if not p.get("root_event", True):
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
    event = None
    best = CLUSTER_KM
    for e in candidates:
        d = distance_km(row.lat, row.lon, e.lat, e.lon)
        if d <= best:
            event, best = e, d
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
    event.title = "{0} reported in {1}".format(label_for(top_code), place)[
        :300
    ]
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
    r"drones?|rockets?|fighting|clash(es|ed)?|killed|troops|offensive|"
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
    or summary, and use words for that kind of event in the headline.

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
    # The kind of event must be in the headline itself: a summary that
    # mentions the city and, somewhere, "war" is not a report of fighting.
    return [a for a in rows.scalars() if words.search(a.title)]


async def review_gdelt(db: AsyncSession) -> set[str]:
    """Promote or demote recent GDELT events.

    Active needs both: enough outlets reporting the same kind of event
    (set at fusion as "eligible"), and corroboration from the news feeds,
    one headline, or two from different outlets for seat-of-government
    places. Events that lose either go back to unconfirmed.
    """
    since = utcnow() - timedelta(hours=REVIEW_HOURS)
    rows = (
        await db.execute(
            select(Event).where(
                Event.key.is_(None),
                Event.type.in_(("conflict", "unrest")),
                Event.status != "expired",
                Event.last_updated >= since,
            )
        )
    ).scalars()
    changed: set[str] = set()
    for event in rows:
        data = dict(event.data or {})
        backing = []
        if data.get("eligible"):
            backing = await corroborating_articles(db, event)
        needed = 2 if seat_of_government(event.place) else 1
        outlets = {a.outlet for a in backing}
        corroborated = len(outlets) >= needed
        status = (
            "active"
            if data.get("eligible") and corroborated
            else ("candidate")
        )
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
            changed.add(event.id)
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
