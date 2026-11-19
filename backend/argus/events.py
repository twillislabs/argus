"""Event queries and serialisation shared by the API and the worker."""

import re
from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from argus.db import utcnow
from argus.fusion import corroborating_articles
from argus.models import Article, Event, EventSource, RawRecord, Source

SEVERITY_NAMES = {
    1: "info",
    2: "elevated",
    3: "high",
    4: "critical",
    5: "catastrophic",
}


def event_dict(e: Event) -> dict[str, Any]:
    return {
        "id": e.id,
        "type": e.type,
        "severity": e.severity,
        "severity_name": SEVERITY_NAMES.get(e.severity, "info"),
        "status": e.status,
        "title": e.title,
        "summary": e.summary,
        "place": e.place,
        "country": e.country,
        "lat": e.lat,
        "lon": e.lon,
        "first_seen": e.first_seen.isoformat(),
        "last_updated": e.last_updated.isoformat(),
        "confidence": e.confidence,
        "source_count": e.source_count,
        "article_count": e.article_count,
        "data": e.data or {},
    }


def article_dict(a: Article) -> dict[str, Any]:
    return {
        "id": a.id,
        "outlet": a.outlet,
        "url": a.url,
        "title": a.title,
        "summary": a.summary,
        "published_at": a.published_at.isoformat(),
    }


def parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    """'west,south,east,north' in degrees. East < west crosses 180."""
    if not bbox:
        return None
    try:
        w, s, e, n = (float(v) for v in bbox.split(","))
    except ValueError as exc:
        raise ValueError("bbox must be west,south,east,north") from exc
    if not (-180 <= w <= 180 and -180 <= e <= 180 and -90 <= s <= n <= 90):
        raise ValueError("bbox is out of range")
    return w, s, e, n


async def query_events(
    db: AsyncSession,
    *,
    bbox: tuple[float, float, float, float] | None = None,
    types: list[str] | None = None,
    min_severity: int = 1,
    hours: int = 24,
    include_candidates: bool = False,
    limit: int = 2000,
) -> list[Event]:
    since = utcnow() - timedelta(hours=hours)
    statuses = ["active", "candidate"] if include_candidates else ["active"]
    q = select(Event).where(
        Event.status.in_(statuses),
        Event.last_updated >= since,
        Event.severity >= min_severity,
    )
    if types:
        q = q.where(Event.type.in_(types))
    if bbox:
        w, s, e, n = bbox
        q = q.where(Event.lat.between(s, n))
        if w <= e:
            q = q.where(Event.lon.between(w, e))
        else:
            q = q.where(or_(Event.lon >= w, Event.lon <= e))
    q = q.order_by(Event.severity.desc(), Event.last_updated.desc())
    return list((await db.execute(q.limit(limit))).scalars())


async def event_sources(db: AsyncSession, event_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(RawRecord)
            .join(EventSource, EventSource.raw_record_id == RawRecord.id)
            .where(EventSource.event_id == event_id)
            .order_by(RawRecord.observed_at.desc())
            .limit(50)
        )
    ).scalars()
    out = []
    for r in rows:
        p = r.payload or {}
        out.append(
            {
                "source": r.source,
                "observed_at": r.observed_at.isoformat(),
                "url": p.get("url"),
                "label": p.get("label") or p.get("title") or r.kind,
                "articles": p.get("articles"),
                "external_id": r.external_id,
            }
        )
    return out


TOPIC_WORDS = {
    "quake": r"earthquakes?|quakes?|tremors?|seismic|aftershocks?|magnitude",
    "fire": r"fires?|wildfires?|blazes?|burn(s|ing|ed)?|bushfires?",
    "maritime": (
        r"ships?|vessels?|tankers?|navy|naval|maritime|port|piracy|pirates?|"
        r"seized|boarded|strait|coast ?guard|houthis?|mines?"
    ),
    "hazard": (
        r"floods?|flooding|cyclones?|hurricanes?|typhoons?|storms?|"
        r"volcan(o|oes|ic)|erupt(s|ed|ion)?|droughts?|tsunamis?|landslides?|"
        r"wildfires?|fires?|heat ?wave|blizzards?|snow|dust ?storms?|ash"
    ),
}


def _match_terms(event: Event) -> list[str]:
    """Place names a related headline must mention: the town or city
    (not the country, which alone matches far too much), or the country
    for an event placed at country level."""
    parts = [p.strip() for p in (event.place or "").split(",") if p.strip()]
    first = parts[0] if parts else ""
    # Drop USGS distance prefixes like "12 km SW of ".
    if " of " in first:
        first = first.rsplit(" of ", 1)[-1].strip()
    if len(first) >= 4 and first != event.country:
        return [first]
    if event.country and len(event.country) >= 4:
        return [event.country]
    return []


async def related_articles(
    db: AsyncSession, event: Event, limit: int = 12
) -> list[Article]:
    """Headlines about this event: they name its place and use words for
    that kind of event in the headline itself. GDELT events use the same
    rule that confirms them (fusion.corroborating_articles)."""
    if event.type in ("conflict", "unrest"):
        return (await corroborating_articles(db, event))[:limit]
    terms = _match_terms(event)
    pattern = TOPIC_WORDS.get(event.type)
    if not terms or not pattern:
        return []
    words = re.compile(r"\b({0})\b".format(pattern), re.IGNORECASE)
    window = timedelta(hours=18)
    conditions = []
    for term in terms:
        like = "%{0}%".format(term.replace("%", "").replace("_", ""))
        conditions.append(Article.title.ilike(like))
        conditions.append(Article.summary.ilike(like))
    rows = await db.execute(
        select(Article)
        .where(
            Article.published_at >= event.first_seen - window,
            Article.published_at <= event.last_updated + window,
            or_(*conditions),
        )
        .order_by(Article.published_at.desc())
        .limit(100)
    )
    # The headline must say what happened and name the place (or the
    # country), not only the summary.
    names = [t.lower() for t in terms]
    if event.country and len(event.country) >= 4:
        names.append(event.country.lower())
    return [
        a
        for a in rows.scalars()
        if words.search(a.title) and any(n in a.title.lower() for n in names)
    ][:limit]


async def summary(db: AsyncSession, hours: int = 24) -> dict[str, Any]:
    since = utcnow() - timedelta(hours=hours)
    active = (Event.status == "active", Event.last_updated >= since)
    by_type = dict(
        (
            await db.execute(
                select(Event.type, func.count())
                .where(*active)
                .group_by(Event.type)
            )
        ).all()
    )
    by_severity = dict(
        (
            await db.execute(
                select(Event.severity, func.count())
                .where(*active)
                .group_by(Event.severity)
            )
        ).all()
    )
    latest = (
        await db.execute(
            select(Event)
            .where(*active)
            .order_by(Event.last_updated.desc())
            .limit(25)
        )
    ).scalars()
    top = (
        await db.execute(
            select(Event)
            .where(*active)
            .order_by(Event.severity.desc(), Event.last_updated.desc())
            .limit(8)
        )
    ).scalars()
    news = (
        await db.execute(
            select(Article).order_by(Article.published_at.desc()).limit(20)
        )
    ).scalars()
    return {
        "hours": hours,
        "total": sum(by_type.values()),
        "by_type": by_type,
        "by_severity": {str(k): v for k, v in by_severity.items()},
        "latest": [event_dict(e) for e in latest],
        "top": [event_dict(e) for e in top],
        "news": [article_dict(a) for a in news],
        "sources": await source_status(db),
    }


async def source_status(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(Source).order_by(Source.name))).scalars()
    return [
        {
            "name": s.name,
            "label": s.label,
            "enabled": s.enabled,
            "interval_s": s.interval_s,
            "last_run_at": s.last_run_at.isoformat()
            if s.last_run_at
            else None,
            "last_success_at": (
                s.last_success_at.isoformat() if s.last_success_at else None
            ),
            "last_error": s.last_error,
            "last_count": s.last_count,
        }
        for s in rows
    ]
