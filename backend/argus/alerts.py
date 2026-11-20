"""Alerts: each user's rules, checked by the API every minute against
what it already holds (events, air-raid alerts, FAA status, patterns,
live aircraft and ships, space weather), delivered in Argus (the bell)
and, unless it's quiet hours, by ntfy and/or a webhook.

An alert fires once per rule and key (an event id, an oblast alert's
start, an airport's ground stop on a day ...): the alerts table's unique
(rule_id, key) makes sure of that across restarts. Each rule sends at
most RULE_CAP an hour; a new rule only fires for things that start
after it was made, so making one doesn't flood you with the backlog.
"""

import asyncio
import ipaddress
import logging
import math
from datetime import datetime, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from argus import events as ev
from argus import patterns as pat
from argus import secrets
from argus.db import utcnow
from argus.models import Alert, AlertChannel, AlertRule, ServerSetting

log = logging.getLogger("argus.alerts")

KINDS = ("events", "raids", "airport", "pattern", "watch", "space")
EVERY_S = 60
RULE_CAP = 10  # alerts per rule per hour
NTFY_DEFAULT = "https://ntfy.sh"
BLOCKED_HOSTS = {"localhost", "db", "nats", "api", "worker", "web", "tiles"}
SEVERITY_PRIORITY = {1: 2, 2: 3, 3: 3, 4: 4, 5: 5}  # ntfy priority


# --- areas ----------------------------------------------------------------


def in_area(area: dict | None, lat: float | None, lon: float | None) -> bool:
    """A point in a rule's area: {"center": [lon, lat], "radius_km": r}
    or {"ring": [[lon, lat], ...]}. No area means anywhere."""
    if not area:
        return True
    if lat is None or lon is None:
        return False
    if area.get("center"):
        clon, clat = area["center"]
        return _km(clat, clon, lat, lon) <= float(area.get("radius_km") or 0)
    ring = area.get("ring") or []
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=False):
        if (y1 > lat) != (y2 > lat):
            x = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x:
                inside = not inside
    return inside


def _km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371 * math.asin(min(1.0, math.sqrt(h)))


# --- what each kind of rule finds ------------------------------------------
#
# Each returns candidate alerts: {key, title, body, link, lat, lon,
# severity}. `since` is when the rule started counting (its creation).


async def find_events(db, rule, state, since):
    p = rule.params or {}
    types = [t for t in p.get("types") or [] if isinstance(t, str)] or None
    rows = await ev.query_events(
        db,
        types=types,
        min_severity=int(p.get("min_severity") or 3),
        hours=6,
        limit=500,
    )
    out = []
    for e in rows:
        if e.first_seen < since or not in_area(p.get("area"), e.lat, e.lon):
            continue
        out.append(
            {
                "key": "event:{0}".format(e.id),
                "title": e.title[:180],
                "body": "{0} · {1}".format(
                    ", ".join(x for x in (e.place, e.country) if x),
                    ev.SEVERITY_NAMES.get(e.severity, ""),
                ),
                "link": "#e={0}".format(e.id),
                "lat": e.lat,
                "lon": e.lon,
                "severity": e.severity,
            }
        )
    return out


async def find_raids(db, rule, state, since):
    p = rule.params or {}
    raids = await state.raids.get()
    out = []
    want = set(p.get("ukraine") or [])
    for a in raids.get("ukraine") or []:
        if not a.get("active") or a.get("long_running"):
            continue
        if "*" not in want and a["id"] not in want:
            continue
        started = a.get("since") or ""
        if started and datetime.fromisoformat(started) < since:
            continue
        out.append(
            {
                "key": "raid:{0}:{1}".format(a["id"], started),
                "title": "Air-raid alert: {0}".format(a["name"]),
                "body": "Ukraine · since {0} UTC".format(started[11:16]),
                "link": None,
                "lat": a["lat"],
                "lon": a["lon"],
                "severity": 4,
            }
        )
    if p.get("israel"):
        for a in raids.get("israel") or []:
            when = a.get("time") or ""
            if not when or datetime.fromisoformat(when) < since:
                continue
            if not in_area(p.get("israel_area"), a["lat"], a["lon"]):
                continue
            out.append(
                {
                    "key": "raid:{0}:{1}".format(a["id"], when),
                    "title": "{0}: {1}".format(
                        a.get("threat_label") or "Alert", a["name"]
                    ),
                    "body": "Israel · {0} UTC".format(when[11:16]),
                    "link": None,
                    "lat": a["lat"],
                    "lon": a["lon"],
                    "severity": 4,
                }
            )
    return out


def faa_level(items: list[dict]) -> str | None:
    if any(
        i["kind"] == "ground_stop"
        or (i["kind"] == "closure" and not i.get("partial"))
        for i in items
    ):
        return "stop"
    if any(i["kind"] in ("ground_delay", "delay") for i in items):
        return "delay"
    return None


async def find_airport(db, rule, state, since):
    p = rule.params or {}
    codes = {str(c).upper() for c in p.get("codes") or []}
    want = set(p.get("levels") or ["stop"])
    status = await state.faa.get()
    day = utcnow().strftime("%Y-%m-%d")
    out = []
    for code in sorted(codes):
        items = (status.get("airports") or {}).get(code) or []
        level = faa_level(items)
        if level not in want:
            continue
        what = ", ".join(
            sorted(
                {
                    i["kind"].replace("_", " ")
                    for i in items
                    if i["kind"] != "closure" or not i.get("partial")
                }
            )
        )
        reason = next((i.get("reason") for i in items if i.get("reason")), "")
        out.append(
            {
                "key": "airport:{0}:{1}:{2}".format(code, level, day),
                "title": "{0}: {1}".format(
                    code, "ground stop" if level == "stop" else "delays"
                ),
                "body": "FAA: {0}{1}".format(
                    what, " ({0})".format(reason) if reason else ""
                )[:300],
                "link": None,
                "lat": None,
                "lon": None,
                "severity": 4 if level == "stop" else 3,
            }
        )
    return out


async def find_pattern(db, rule, state, since):
    p = rule.params or {}
    found = []
    if p.get("air", True):
        bucket = utcnow().strftime("%Y%m%d") + str(utcnow().hour // 3)
        for a in pat.air_patterns(state.air):
            if not in_area(p.get("area"), a["lat"], a["lon"]):
                continue
            found.append(
                {
                    "key": "air:{0}:{1}:{2}".format(
                        a["hex"], a["kind"], bucket
                    ),
                    "title": "{0} {1}".format(
                        a.get("callsign") or a["hex"].upper(),
                        "flying a {0}".format(a["kind"]),
                    ),
                    "body": "{0}{1}, {2} laps{3}".format(
                        a.get("type") or "Military aircraft",
                        " ({0})".format(a["role"]) if a.get("role") else "",
                        a["laps"],
                        " near {0}".format(a["near"]) if a.get("near") else "",
                    ),
                    "link": "#ac={0}".format(a["hex"]),
                    "lat": a["lat"],
                    "lon": a["lon"],
                    "severity": 3,
                }
            )
    if p.get("sea", True):
        cables = getattr(state, "cable_index", None)
        index = cables[1] if cables else None
        if index is None:
            row = await db.get(ServerSetting, "layer:cables")
            if row is not None:
                index = pat.CableIndex((row.value or {}).get("cables") or {})
                state.cable_index = ((row.value or {}).get("fetched"), index)
        day = utcnow().strftime("%Y%m%d")
        for s in pat.sea_patterns(state.sea, index):
            if not in_area(p.get("area"), s["lat"], s["lon"]):
                continue
            found.append(
                {
                    "key": "sea:{0}:{1}".format(s["mmsi"], day),
                    "title": "{0} loitering on {1}".format(
                        s.get("name") or "MMSI {0}".format(s["mmsi"]),
                        s["cable"],
                    ),
                    "body": "{0} h within 3 km, {1} km from the cable".format(
                        s["hours"], s["cable_km"]
                    ),
                    "link": "#ship={0}".format(s["mmsi"]),
                    "lat": s["lat"],
                    "lon": s["lon"],
                    "severity": 4,
                }
            )
    return found


async def find_watch(db, rule, state, since):
    p = rule.params or {}
    day = utcnow().strftime("%Y%m%d")
    want = {
        str(x).strip().upper()
        for x in p.get("aircraft") or []
        if str(x).strip()
    }
    out = []
    for a in state.air.aircraft.values():
        names = {
            a.get("hex", "").upper(),
            (a.get("callsign") or "").upper(),
            (a.get("reg") or "").upper(),
        }
        hit = want & names
        if not hit or not in_area(p.get("area"), a.get("lat"), a.get("lon")):
            continue
        out.append(
            {
                "key": "ac:{0}:{1}".format(a["hex"], day),
                "title": "{0} is up".format(
                    a.get("callsign") or a["hex"].upper()
                ),
                "body": "{0} · {1} ft".format(
                    a.get("type") or "Aircraft", a.get("alt_ft") or "?"
                ),
                "link": "#ac={0}".format(a["hex"]),
                "lat": a.get("lat"),
                "lon": a.get("lon"),
                "severity": 3,
            }
        )
    ships = {int(x) for x in p.get("vessels") or [] if str(x).isdigit()}
    for mmsi in ships:
        v = state.sea.vessels.get(mmsi)
        if (
            not v
            or "lat" not in v
            or not in_area(p.get("area"), v.get("lat"), v.get("lon"))
        ):
            continue
        out.append(
            {
                "key": "ship:{0}:{1}".format(mmsi, day),
                "title": "{0} is in view".format(
                    v.get("name") or "MMSI {0}".format(mmsi)
                ),
                "body": "{0} kn{1}".format(
                    v.get("sog") if v.get("sog") is not None else "?",
                    " · to {0}".format(v["destination"])
                    if v.get("destination")
                    else "",
                ),
                "link": "#ship={0}".format(mmsi),
                "lat": v.get("lat"),
                "lon": v.get("lon"),
                "severity": 3,
            }
        )
    return out


async def find_space(db, rule, state, since):
    g_min = int((rule.params or {}).get("g_min") or 3)
    sw = await state.spaceweather.get()
    g = int(((sw.get("now") or {}).get("G") or {}).get("scale") or 0)
    if g < g_min:
        return []
    return [
        {
            "key": "space:G{0}:{1}".format(g, utcnow().strftime("%Y%m%d")),
            "title": "Geomagnetic storm G{0}".format(g),
            "body": "NOAA SWPC: {0}; Kp {1}".format(
                ((sw.get("now") or {}).get("G") or {}).get("text") or "",
                (sw.get("kp") or {}).get("now"),
            ),
            "link": "/brief",
            "lat": None,
            "lon": None,
            "severity": 3 + min(2, g // 2),
        }
    ]


FINDERS = {
    "events": find_events,
    "raids": find_raids,
    "airport": find_airport,
    "pattern": find_pattern,
    "watch": find_watch,
    "space": find_space,
}


# --- delivery -------------------------------------------------------------


def url_allowed(url: str) -> bool:
    """A delivery URL Argus may post to: http(s), not this server's own
    containers, loopback or cloud metadata addresses. LAN hosts are fine
    (Home Assistant, a local ntfy)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if (
        parts.scheme not in ("http", "https")
        or not host
        or host in BLOCKED_HOSTS
    ):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return not host.endswith(".internal")
    return not (
        ip.is_loopback
        or ip.is_link_local
        or ip.is_unspecified
        or ip.is_multicast
    )


def in_quiet(ch: AlertChannel | None, now: datetime) -> bool:
    if not ch or not ch.quiet_from or not ch.quiet_to:
        return False
    try:
        local = now.astimezone(ZoneInfo(ch.tz or "UTC"))
    except (KeyError, ValueError):
        local = now
    hhmm = local.strftime("%H:%M")
    a, b = ch.quiet_from, ch.quiet_to
    return a <= hhmm < b if a <= b else hhmm >= a or hhmm < b


def _link(ch: AlertChannel | None, link: str | None) -> str | None:
    if not link or not ch or not ch.base_url:
        return None
    return "{0}/{1}".format(ch.base_url.rstrip("/"), link.lstrip("/"))


async def deliver(
    client: httpx.AsyncClient, ch, secret_key, alert: dict
) -> str:
    """Push one alert; returns what happened ("sent", "failed: ...")."""
    results = []
    click = _link(ch, alert.get("link"))
    topic = (
        secrets.decrypt(secret_key, ch.ntfy_topic)
        if ch and ch.ntfy_topic
        else None
    )
    if topic:
        server = (ch.ntfy_server or NTFY_DEFAULT).rstrip("/")
        if not url_allowed(server):
            results.append("ntfy: server not allowed")
        else:
            body = {
                "topic": topic,
                "title": alert["title"][:200],
                "message": alert.get("body") or alert["title"],
                "priority": SEVERITY_PRIORITY.get(
                    int(alert.get("severity") or 3), 3
                ),
                "tags": ["rotating_light"]
                if int(alert.get("severity") or 3) >= 4
                else ["satellite"],
            }
            if click:
                body["click"] = click
            try:
                r = await client.post(server, json=body)
                results.append(
                    "ntfy: sent"
                    if r.status_code < 300
                    else "ntfy: {0}".format(r.status_code)
                )
            except httpx.HTTPError as exc:
                results.append("ntfy: {0}".format(type(exc).__name__))
    hook = (
        secrets.decrypt(secret_key, ch.webhook_url)
        if ch and ch.webhook_url
        else None
    )
    if hook:
        if not url_allowed(hook):
            results.append("webhook: URL not allowed")
        else:
            text = "{0}\n{1}{2}".format(
                alert["title"],
                alert.get("body") or "",
                "\n{0}".format(click) if click else "",
            )
            if ch.webhook_format == "discord":
                payload = {
                    "content": "**{0}**\n{1}{2}".format(
                        alert["title"],
                        alert.get("body") or "",
                        "\n{0}".format(click) if click else "",
                    )[:1900]
                }
            elif ch.webhook_format == "slack":
                payload = {"text": text[:2900]}
            else:
                payload = {
                    "title": alert["title"],
                    "body": alert.get("body"),
                    "url": click,
                    "severity": alert.get("severity"),
                    "lat": alert.get("lat"),
                    "lon": alert.get("lon"),
                    "kind": alert.get("kind"),
                    "rule": alert.get("rule"),
                    "time": utcnow().isoformat(),
                }
            try:
                r = await client.post(hook, json=payload)
                results.append(
                    "webhook: sent"
                    if r.status_code < 300
                    else "webhook: {0}".format(r.status_code)
                )
            except httpx.HTTPError as exc:
                results.append("webhook: {0}".format(type(exc).__name__))
    if not results:
        return "off"
    return "; ".join(results)[:120]


# --- the loop -------------------------------------------------------------


async def run_once(db_factory, state, secret_key, client, now=None) -> int:
    """Check every enabled rule once; returns how many alerts fired."""
    now = now or utcnow()
    fired = 0
    async with db_factory() as db:
        rules = list(
            (
                await db.execute(
                    select(AlertRule).where(AlertRule.enabled.is_(True))
                )
            ).scalars()
        )
        channels = {
            c.user_id: c
            for c in (await db.execute(select(AlertChannel))).scalars()
        }
        for rule in rules:
            finder = FINDERS.get(rule.kind)
            if finder is None:
                continue
            try:
                found = await finder(db, rule, state, rule.created_at)
            except Exception as exc:  # noqa: BLE001 - one rule can't stop the rest
                log.warning("Alert rule {0} failed: {1}".format(rule.id, exc))
                continue
            if not found:
                continue
            keys = {f["key"] for f in found}
            seen = set(
                (
                    await db.execute(
                        select(Alert.key).where(
                            Alert.rule_id == rule.id, Alert.key.in_(keys)
                        )
                    )
                ).scalars()
            )
            recent = (
                await db.execute(
                    select(func.count())
                    .select_from(Alert)
                    .where(
                        Alert.rule_id == rule.id,
                        Alert.created_at >= now - timedelta(hours=1),
                    )
                )
            ).scalar_one()
            ch = channels.get(rule.user_id)
            for f in found:
                if f["key"] in seen:
                    continue
                if recent >= RULE_CAP:
                    break
                recent += 1
                if not rule.push:
                    pushed = "off"
                elif in_quiet(ch, now):
                    pushed = "quiet"
                else:
                    pushed = await deliver(
                        client,
                        ch,
                        secret_key,
                        f | {"kind": rule.kind, "rule": rule.name},
                    )
                db.add(
                    Alert(
                        user_id=rule.user_id,
                        rule_id=rule.id,
                        key=f["key"][:120],
                        title=f["title"][:200],
                        body=(f.get("body") or "")[:2000],
                        link=f.get("link"),
                        lat=f.get("lat"),
                        lon=f.get("lon"),
                        severity=int(f.get("severity") or 3),
                        created_at=now,
                        pushed=pushed,
                    )
                )
                rule.last_fired_at = now
                fired += 1
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
    return fired


async def alerts_loop(app) -> None:
    """Runs in the API (it holds the live picture), every EVERY_S."""
    state = app.state
    settings = state.settings
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0),
        headers={"User-Agent": settings.user_agent},
    ) as client:
        await asyncio.sleep(20)  # let the live feeds fill first
        while True:
            try:
                n = await run_once(
                    state.db.sessionmaker, state, settings.secret_key, client
                )
                if n:
                    log.info("alerts: {0} fired".format(n))
            except Exception as exc:  # noqa: BLE001 - keep checking
                log.warning("alerts pass failed: {0}".format(exc))
            await asyncio.sleep(EVERY_S)
