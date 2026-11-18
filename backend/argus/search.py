"""Universal search: work out what a query is, then find matches.

decode() is pure: it reads the query and returns every plausible reading
(coordinates, a flight number, an aircraft hex or registration, an
airport, a filter keyword). resolve() turns those readings into results
using the live aircraft picture, adsb.lol, places and stored events.

Each result tells the map what to do with it:
    kind       coords, aircraft, flight, airport, place, event or filter
    label      the main line; detail is the second line
    lat, lon   where to fly to, with height_m the camera height
    hex        for aircraft, the one to select and follow
    id         for events, the one to open
    filter     for filters: {"events": [types]} or {"aircraft": mode}
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from argus import places
from argus.aviation import AirClient, LiveAir, airlines, airports
from argus.models import Event

log = logging.getLogger("argus.search")

COORDS = re.compile(
    r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$"
)
IATA_FLIGHT = re.compile(r"^([A-Z0-9]{2})\s?(\d{1,4}[A-Z]?)$")
ICAO_FLIGHT = re.compile(r"^([A-Z]{3})\s?(\d{1,4}[A-Z]{0,2})$")
CALLSIGN = re.compile(r"^(?=.*\d)[A-Z0-9]{3,8}$")
HEX = re.compile(r"^[0-9A-F]{6}$")
REG = re.compile(r"^(N\d{1,5}[A-Z]{0,2}|[A-Z]{1,2}-[A-Z0-9]{3,5})$")
SQUAWKS = {"7500": "hijack", "7600": "radio failure", "7700": "emergency"}

EVENT_WORDS = {
    "quake": ["quake"],
    "quakes": ["quake"],
    "earthquake": ["quake"],
    "earthquakes": ["quake"],
    "seismic": ["quake"],
    "fire": ["fire"],
    "fires": ["fire"],
    "wildfire": ["fire"],
    "wildfires": ["fire"],
    "conflict": ["conflict"],
    "fighting": ["conflict"],
    "war": ["conflict"],
    "attack": ["conflict"],
    "attacks": ["conflict"],
    "protest": ["unrest"],
    "protests": ["unrest"],
    "unrest": ["unrest"],
    "riot": ["unrest"],
    "riots": ["unrest"],
}
EVENT_LABELS = {
    "quake": "Earthquakes",
    "fire": "Fires",
    "conflict": "Conflict",
    "unrest": "Protests and unrest",
}
AIR_WORDS = {
    "military": "military",
    "mil": "military",
    "aircraft": "all",
    "planes": "all",
    "flights": "all",
    "emergency": "emergency",
    "emergencies": "emergency",
    "squawk": "emergency",
    "tanker": "Tanker",
    "tankers": "Tanker",
    "isr": "ISR",
    "surveillance": "ISR",
    "awacs": "AEW&C",
    "bomber": "Bomber",
    "bombers": "Bomber",
    "airlift": "Airlift",
    "cargo": "Airlift",
    "helicopter": "Helicopter",
    "helicopters": "Helicopter",
    "fighter": "Fighter",
    "fighters": "Fighter",
}
AIR_LABELS = {
    "military": "Military aircraft",
    "all": "All aircraft",
    "emergency": "Aircraft squawking an emergency",
}


@dataclass
class Reading:
    kind: str
    value: Any
    extra: dict = field(default_factory=dict)


def decode(query: str) -> list[Reading]:
    """Every plausible reading of the query, most specific first."""
    q = " ".join(query.strip().split())
    if not q:
        return []
    up = q.upper()
    compact = up.replace(" ", "")
    out: list[Reading] = []

    m = COORDS.match(q)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            out.append(Reading("coords", (lat, lon)))

    if up in SQUAWKS:
        out.append(Reading("squawk", up))

    by_iata, by_icao = airlines()
    m = IATA_FLIGHT.match(up)
    if m and not m.group(1).isdigit() and m.group(1) in by_iata:
        airline = by_iata[m.group(1)]
        number = m.group(2).lstrip("0") or "0"
        out.append(
            Reading(
                "flight",
                airline.icao + number,
                {"flight": m.group(1) + number, "airline": airline.name},
            )
        )
    m = ICAO_FLIGHT.match(up)
    if m:
        airline = by_icao.get(m.group(1))
        number = m.group(2).lstrip("0") or "0"
        out.append(
            Reading(
                "flight",
                m.group(1) + number,
                {"airline": airline.name if airline else None},
            )
        )

    if HEX.match(compact):
        out.append(Reading("hex", compact.lower()))
    if REG.match(compact):
        out.append(Reading("reg", compact))

    if not any(r.kind == "flight" for r in out) and CALLSIGN.match(compact):
        out.append(Reading("callsign", compact))

    if len(compact) in (3, 4) and compact.isalpha():
        airport = airports().get(compact)
        if airport is not None:
            out.append(Reading("airport", airport))

    words = q.lower().split()
    types: list[str] = []
    for w in words:
        for t in EVENT_WORDS.get(w, []):
            if t not in types:
                types.append(t)
    if types:
        out.append(Reading("events_filter", types))
    for w in words:
        mode = AIR_WORDS.get(w)
        if mode:
            out.append(Reading("aircraft_filter", mode))
            break
    return out


def _aircraft_result(a: dict, why: str | None = None) -> dict:
    name = a.get("callsign") or a.get("reg") or a["hex"].upper()
    bits = [b for b in (a.get("type"), a.get("role"), a.get("reg")) if b]
    if a.get("alt_ft") is not None:
        bits.append(
            "on the ground"
            if a.get("ground")
            else "{0:,} ft".format(a["alt_ft"])
        )
    if why:
        bits.insert(0, why)
    return {
        "kind": "aircraft",
        "label": name,
        "detail": " · ".join(bits),
        "hex": a["hex"],
        "lat": a["lat"],
        "lon": a["lon"],
        "height_m": 150000,
        "mil": a.get("mil", False),
    }


def _place_height(population: int) -> int:
    if population > 2_000_000:
        return 90000
    if population > 200_000:
        return 45000
    return 20000


async def _aircraft(
    reading: Reading, air: LiveAir, client: AirClient | None
) -> list[dict]:
    hits = air.find(reading.value)
    if not hits and client is not None:
        hits = client.find_recent(reading.value)
    if not hits and client is not None:
        kind = "callsign" if reading.kind == "flight" else reading.kind
        try:
            hits = await client.lookup(kind, reading.value)
        except Exception as exc:  # noqa: BLE001 - search still answers
            log.warning("Aircraft lookup failed: {0}".format(exc))
    why = None
    if reading.kind == "flight":
        flight = reading.extra.get("flight")
        airline = reading.extra.get("airline")
        why = " ".join(b for b in (airline, flight) if b) or None
    return [_aircraft_result(a, why) for a in hits[:5]]


async def resolve(
    query: str,
    db: AsyncSession,
    air: LiveAir,
    client: AirClient | None,
    limit: int = 12,
) -> list[dict]:
    readings = decode(query)
    results: list[dict] = []
    seen_hex: set[str] = set()

    def add(item: dict) -> None:
        if item.get("hex"):
            if item["hex"] in seen_hex:
                return
            seen_hex.add(item["hex"])
        results.append(item)

    for r in readings:
        if r.kind == "coords":
            lat, lon = r.value
            add(
                {
                    "kind": "coords",
                    "label": "{0:.4f}, {1:.4f}".format(lat, lon),
                    "detail": "Go to these coordinates",
                    "lat": lat,
                    "lon": lon,
                    "height_m": 8000,
                }
            )
        elif r.kind == "squawk":
            for a in air.aircraft.values():
                if a.get("squawk") == r.value:
                    add(_aircraft_result(a, "Squawk {0}".format(r.value)))
            add(
                {
                    "kind": "filter",
                    "label": "Squawk {0} ({1})".format(
                        r.value, SQUAWKS[r.value]
                    ),
                    "detail": "Show aircraft squawking an emergency",
                    "filter": {"aircraft": "emergency"},
                }
            )
        elif r.kind in ("flight", "callsign", "hex", "reg"):
            found = await _aircraft(r, air, client)
            for item in found:
                add(item)
            if not found and r.kind == "flight":
                airline = r.extra.get("airline")
                add(
                    {
                        "kind": "flight",
                        "label": r.extra.get("flight") or r.value,
                        "detail": " · ".join(
                            b
                            for b in (airline, "not airborne or not seen now")
                            if b
                        ),
                        "callsign": r.value,
                    }
                )
        elif r.kind == "airport":
            a = r.value
            add(
                {
                    "kind": "airport",
                    "label": a.label(),
                    "detail": ", ".join(b for b in (a.city, a.cc) if b),
                    "lat": a.lat,
                    "lon": a.lon,
                    "height_m": 30000,
                }
            )
        elif r.kind == "events_filter":
            add(
                {
                    "kind": "filter",
                    "label": " and ".join(EVENT_LABELS[t] for t in r.value),
                    "detail": "Show only these events",
                    "filter": {"events": r.value},
                }
            )
        elif r.kind == "aircraft_filter":
            label = AIR_LABELS.get(r.value) or "{0} aircraft".format(r.value)
            add(
                {
                    "kind": "filter",
                    "label": label,
                    "detail": "Turn on aircraft and show these",
                    "filter": {"aircraft": r.value},
                }
            )

    text = query.strip()
    if len(text) >= 2 and not any(r.kind == "coords" for r in readings):
        for p in await asyncio.to_thread(places.search, text, 5):
            add(
                {
                    "kind": "place",
                    "label": p.label(),
                    "detail": "Place · population {0:,}".format(p.population),
                    "lat": p.lat,
                    "lon": p.lon,
                    "height_m": _place_height(p.population),
                }
            )
        like = "%{0}%".format(text.replace("%", "").replace("_", ""))
        rows = (
            await db.execute(
                select(Event)
                .where(Event.status != "candidate")
                .where(or_(Event.title.ilike(like), Event.place.ilike(like)))
                .order_by(Event.severity.desc(), Event.last_updated.desc())
                .limit(5)
            )
        ).scalars()
        for e in rows:
            add(
                {
                    "kind": "event",
                    "label": e.title,
                    "detail": e.place or e.type,
                    "id": e.id,
                    "lat": e.lat,
                    "lon": e.lon,
                    "height_m": 400000,
                }
            )
    return results[:limit]
