"""Disasters and tsunami alerts.

- GDACS (Global Disaster Alert and Coordination System, UN and EU JRC):
  floods, tropical cyclones, volcanoes, droughts and wildfires with a
  green / orange / red alert level. Earthquakes are skipped; USGS covers
  them in more detail.
  https://www.gdacs.org/  (free; credit GDACS)
- NASA EONET (Earth Observatory Natural Event Tracker): named storms,
  wildfires, volcanoes and other natural events. Public domain.
- US tsunami warning centres (NTWC Palmer, PTWC Honolulu): the latest
  bulletin from each as Atom. Public domain.

Each becomes a RawIn of kind "hazard"; fusion.fuse_hazard turns it into
one event per hazard, kept up to date as the source revises it.
"""

from datetime import UTC, datetime, timedelta

import httpx
from defusedxml import ElementTree

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

GDACS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP"
EONET = "https://eonet.gsfc.nasa.gov/api/v3/events"
TSUNAMI_FEEDS = {
    "NTWC": "https://www.tsunami.gov/events/xml/PAAQAtom.xml",
    "PTWC": "https://www.tsunami.gov/events/xml/PHEBAtom.xml",
}

GDACS_KINDS = {
    "FL": "flood",
    "TC": "cyclone",
    "VO": "volcano",
    "DR": "drought",
    "WF": "wildfire",
}
GDACS_LEVEL = {"green": 1, "orange": 3, "red": 4}
EONET_KINDS = {
    "severeStorms": "storm",
    "wildfires": "wildfire",
    "volcanoes": "volcano",
    "floods": "flood",
    "landslides": "landslide",
    "drought": "drought",
    "dustHaze": "dust",
    "earthquakes": None,  # USGS covers these
    "seaLakeIce": None,  # icebergs: not an incident
    "snow": "snow",
    "tempExtremes": "heat",
    "waterColor": None,
    "manmade": "manmade",
}

ATOM = "{http://www.w3.org/2005/Atom}"
GEO = "{http://www.w3.org/2003/01/geo/wgs84_pos#}"


def _iso(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def parse_gdacs(doc: dict, now: datetime) -> list[RawIn]:
    out = []
    for f in doc.get("features", []):
        p = f.get("properties") or {}
        kind = GDACS_KINDS.get(p.get("eventtype", ""))
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if kind is None or len(coords) < 2:
            continue
        if str(p.get("iscurrent", "true")).lower() != "true":
            continue
        level = str(p.get("alertlevel", "Green")).lower()
        # Green wildfires are routine and NASA FIRMS already shows the
        # fires themselves; keep only the ones GDACS escalates.
        if kind == "wildfire" and level == "green":
            continue
        out.append(
            RawIn(
                source="gdacs",
                external_id="{0}{1}".format(
                    p.get("eventtype"), p.get("eventid")
                ),
                kind="hazard",
                observed_at=now,
                lat=float(coords[1]),
                lon=float(coords[0]),
                payload={
                    "provider": "GDACS",
                    "hazard": kind,
                    "title": p.get("name") or p.get("description") or kind,
                    "summary": p.get("htmldescription") or "",
                    "severity": GDACS_LEVEL.get(level, 1),
                    "alert": level,
                    "country": p.get("country") or "",
                    "from": p.get("fromdate"),
                    "to": p.get("todate"),
                    "modified": p.get("datemodified"),
                    "url": (p.get("url") or {}).get("report"),
                },
            )
        )
    return out


def _storm_severity(knots: float | None) -> int:
    if knots is None:
        return 2
    if knots >= 96:  # category 3+ hurricane / typhoon
        return 4
    if knots >= 64:  # hurricane / typhoon
        return 3
    return 2


def parse_eonet(doc: dict, now: datetime) -> list[RawIn]:
    out = []
    for e in doc.get("events", []):
        cats = [c.get("id") for c in e.get("categories", [])]
        kind = next(
            (EONET_KINDS.get(c) for c in cats if c in EONET_KINDS), None
        )
        points = [g for g in e.get("geometry", []) if g.get("type") == "Point"]
        if kind is None or not points:
            continue
        title = str(e.get("title") or "")
        # Prescribed burns are planned fires, not incidents.
        if kind == "wildfire" and (
            "prescribed" in title.lower() or " RX" in title.upper()
        ):
            continue
        latest = points[-1]
        lon, lat = latest["coordinates"][:2]
        knots = latest.get("magnitudeValue") if kind == "storm" else None
        sources = e.get("sources") or []
        out.append(
            RawIn(
                source="eonet",
                external_id=str(e.get("id")),
                kind="hazard",
                observed_at=now,
                lat=float(lat),
                lon=float(lon),
                payload={
                    "provider": "NASA EONET",
                    "hazard": kind,
                    "title": e.get("title") or kind,
                    "summary": e.get("description") or "",
                    "severity": (
                        _storm_severity(knots) if kind == "storm" else 2
                    ),
                    "knots": knots,
                    "modified": latest.get("date"),
                    "track": [g["coordinates"][:2] for g in points[-40:]],
                    "url": sources[0].get("url") if sources else e.get("link"),
                },
            )
        )
    return out


TSUNAMI_LEVEL = {"warning": 5, "advisory": 4, "watch": 4, "threat": 4}


def parse_tsunami(xml: bytes, centre: str, now: datetime) -> list[RawIn]:
    """The latest bulletin from one centre, if it's recent."""
    root = ElementTree.fromstring(xml)
    feed_title = (root.findtext(ATOM + "title") or "").strip()
    out = []
    for entry in root.findall(ATOM + "entry"):
        updated = _iso(entry.findtext(ATOM + "updated"))
        lat = entry.findtext(GEO + "lat")
        lon = entry.findtext(GEO + "long")
        if not updated or lat is None or lon is None:
            continue
        if now - updated > timedelta(hours=48):
            continue
        summary_el = entry.find(ATOM + "summary")
        text = (
            " ".join(summary_el.itertext()) if summary_el is not None else ""
        )
        lowered = "{0} {1}".format(feed_title, text).lower()
        level = next((v for k, v in TSUNAMI_LEVEL.items() if k in lowered), 1)
        if "no tsunami danger" in lowered or "no tsunami threat" in lowered:
            level = 1
        link = next(
            (
                a.get("href")
                for a in entry.findall(ATOM + "link")
                if a.get("rel") == "alternate"
            ),
            None,
        )
        place = (entry.findtext(ATOM + "title") or "").strip()
        out.append(
            RawIn(
                source="tsunami",
                external_id=(entry.findtext(ATOM + "id") or "").strip(),
                kind="hazard",
                observed_at=updated,
                lat=float(lat),
                lon=float(lon),
                payload={
                    "provider": centre,
                    "hazard": "tsunami",
                    "title": "{0}: {1}".format(feed_title, place),
                    "summary": " ".join(text.split())[:600],
                    "severity": level,
                    "modified": updated.isoformat(),
                    "url": link,
                },
            )
        )
    return out


class GdacsCollector(Collector):
    name = "gdacs"
    label = "GDACS disasters"
    interval_s = 900
    licence = "GDACS (UN OCHA / EU JRC); free with credit"
    terms_url = "https://www.gdacs.org/About/termsofuse.aspx"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(GDACS)
        if response.status_code != 200:
            raise SourceError(
                "GDACS returned {0}".format(response.status_code)
            )
        return CollectResult(
            records=parse_gdacs(response.json(), datetime.now(UTC))
        )


class EonetCollector(Collector):
    name = "eonet"
    label = "NASA EONET natural events"
    interval_s = 1800
    licence = "Public domain (NASA)"
    terms_url = "https://eonet.gsfc.nasa.gov/what-is-eonet"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(
            EONET, params={"status": "open", "days": "20"}
        )
        if response.status_code != 200:
            raise SourceError(
                "EONET returned {0}".format(response.status_code)
            )
        return CollectResult(
            records=parse_eonet(response.json(), datetime.now(UTC))
        )


class TsunamiCollector(Collector):
    name = "tsunami"
    label = "Tsunami warning centres"
    interval_s = 300
    licence = "Public domain (NOAA)"
    terms_url = "https://www.tsunami.gov/"

    async def collect(self, client: httpx.AsyncClient, cursor):
        now = datetime.now(UTC)
        records, failures = [], []
        for centre, url in TSUNAMI_FEEDS.items():
            try:
                response = await client.get(url)
                response.raise_for_status()
                records += parse_tsunami(response.content, centre, now)
            except (httpx.HTTPError, ElementTree.ParseError) as exc:
                failures.append("{0} ({1})".format(centre, type(exc).__name__))
        if failures and not records and len(failures) == len(TSUNAMI_FEEDS):
            raise SourceError("Both tsunami feeds failed")
        return CollectResult(records=records, failures=failures)
