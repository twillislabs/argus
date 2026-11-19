"""Cyber: internet outages, ransomware victims by country, and newly
known exploited vulnerabilities. All free and keyless:

- IODA (Georgia Tech's Internet Outage Detection and Analysis):
  country-level outage events. Kept: countries with an outage in the
  last 24 hours, the strongest event each.
- ransomware.live: the latest 100 victims claimed on leak sites
  (usually a day or two), counted per country with the sectors and
  groups; "since" says when that list starts. Victim names aren't kept:
  they are criminals' unverified claims.
- CISA's Known Exploited Vulnerabilities catalogue: the newest entries.

The worker's cyber_loop stores the lot in server_settings["layer:cyber"].
"""

import time
from collections import Counter
from datetime import UTC, datetime, timedelta

import httpx

from argus import places

IODA = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events"
RANSOMWARE = "https://api.ransomware.live/v2/recentvictims"
KEV = (
    "https://www.cisa.gov/sites/default/files/feeds/"
    "known_exploited_vulnerabilities.json"
)
OUTAGE_WINDOW = timedelta(hours=24)
RANSOM_WINDOW = timedelta(days=7)
KEV_KEEP = 30


def country_places() -> dict[str, places.Place]:
    """The most populous place per ISO country code: where a country's
    marker goes, and its name (GeoNames style)."""
    best: dict[str, places.Place] = {}
    for p in places.load():
        if p.cc and (p.cc not in best or p.population > best[p.cc].population):
            best[p.cc] = p
    return best


def _cc(v) -> str | None:
    v = str(v or "").strip().upper()
    return v if len(v) == 2 and v.isalpha() else None


def parse_outages(doc: dict, now: float | None = None) -> list[dict]:
    """Countries with an outage overlapping the last 24 hours."""
    now = now or time.time()
    since = now - OUTAGE_WINDOW.total_seconds()
    named = country_places()
    best: dict[str, dict] = {}
    for e in doc.get("data") or []:
        loc = str(e.get("location") or "")
        if not loc.startswith("country/"):
            continue
        cc = _cc(loc.split("/", 1)[1])
        try:
            start = float(e.get("start"))
            duration = float(e.get("duration") or 0)
            score = float(e.get("score") or 0)
        except (TypeError, ValueError):
            continue
        end = start + duration
        if not cc or end < since:
            continue
        if cc in best and best[cc]["score"] >= score:
            continue
        place = named.get(cc)
        best[cc] = {
            "cc": cc,
            "country": place.country if place else e.get("location_name"),
            "start": datetime.fromtimestamp(start, UTC).isoformat(),
            "end": datetime.fromtimestamp(end, UTC).isoformat(),
            "ongoing": end >= now - 1800,
            "source": {
                "bgp": "BGP",
                "gtr": "Google traffic",
                "ping-slash24": "Active probing",
                "merit-nt": "Telescope",
            }.get(str(e.get("datasource")), str(e.get("datasource") or "")),
            "score": round(score),
        }
    return sorted(best.values(), key=lambda o: o["score"], reverse=True)


def parse_ransomware(rows: list, now: datetime | None = None) -> list[dict]:
    """Victims of the last seven days per country: counts, sectors and
    groups, placed at the country's largest city."""
    now = now or datetime.now(UTC)
    named = country_places()
    by_cc: dict[str, dict] = {}
    since: datetime | None = None
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        cc = _cc(r.get("country"))
        try:
            when = datetime.fromisoformat(
                str(r.get("attackdate") or r.get("discovered"))
            )
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if now - when > RANSOM_WINDOW:
            continue
        since = when if since is None else min(since, when)
        if not cc or cc not in named:
            continue
        d = by_cc.setdefault(
            cc,
            {
                "count": 0,
                "sectors": Counter(),
                "groups": Counter(),
                "latest": when,
            },
        )
        d["count"] += 1
        d["latest"] = max(d["latest"], when)
        if r.get("activity") and r["activity"] != "Not Found":
            d["sectors"][str(r["activity"])[:60]] += 1
        if r.get("group"):
            d["groups"][str(r["group"])[:40]] += 1
    out = []
    for cc, d in by_cc.items():
        p = named[cc]
        out.append(
            {
                "cc": cc,
                "country": p.country,
                "lat": round(p.lat, 4),
                "lon": round(p.lon, 4),
                "count": d["count"],
                "since": since.isoformat() if since else None,
                "latest": d["latest"].isoformat(),
                "sectors": [s for s, _ in d["sectors"].most_common(3)],
                "groups": [g for g, _ in d["groups"].most_common(3)],
            }
        )
    return sorted(out, key=lambda x: x["count"], reverse=True)


def parse_kev(doc: dict) -> list[dict]:
    rows = [v for v in doc.get("vulnerabilities") or [] if isinstance(v, dict)]
    rows.sort(
        key=lambda v: (v.get("dateAdded") or "", v.get("cveID") or ""),
        reverse=True,
    )
    return [
        {
            "cve": str(v.get("cveID") or "")[:24],
            "vendor": str(v.get("vendorProject") or "")[:80],
            "product": str(v.get("product") or "")[:80],
            "name": str(v.get("vulnerabilityName") or "")[:160],
            "added": v.get("dateAdded"),
            "due": v.get("dueDate"),
            "ransomware": v.get("knownRansomwareCampaignUse") == "Known",
            "description": str(v.get("shortDescription") or "")[:400],
        }
        for v in rows[:KEV_KEEP]
    ]


async def fetch_outages(client: httpx.AsyncClient) -> list[dict]:
    now = int(time.time())
    r = await client.get(
        IODA,
        params={
            "from": now - int(OUTAGE_WINDOW.total_seconds()),
            "until": now,
            "entityType": "country",
            "limit": 500,
        },
    )
    r.raise_for_status()
    return parse_outages(r.json(), now)


async def fetch_ransomware(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(RANSOMWARE)
    r.raise_for_status()
    return parse_ransomware(r.json())


async def fetch_kev(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(KEV)
    r.raise_for_status()
    return parse_kev(r.json())
