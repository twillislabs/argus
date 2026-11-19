"""Aircraft: reference data, the adsb.lol client, and the live picture.

- Airports (OurAirports, public domain) and airlines (OpenFlights, ODbL)
  are bundled in argus/data and loaded on first use.
- Military aircraft come from adsb.lol /v2/mil, polled by the worker and
  published on NATS; the API keeps the latest positions and a short trail
  per aircraft in memory (LiveAir).
- Civil aircraft are fetched on demand for the area being viewed
  (adsb.lol /v2/point, at most 250 nm), with a short cache.
- Routes and aircraft details come from adsbdb.com, cached for hours.

Privacy: aircraft flagged PIA or LADD (owners who asked not to be shown)
are dropped unless they are military, and registered owner names are
never stored or returned.
"""

import asyncio
import gzip
import logging
import math
import os
import time
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx

from argus.geo import distance_km

log = logging.getLogger("argus.aviation")

DATA = os.path.join(os.path.dirname(__file__), "data")
ADSB_LOL = "https://api.adsb.lol/v2/"
ADSBDB = "https://api.adsbdb.com/v0/"
HEXDB_ROUTE = "https://hexdb.io/callsign-route"

FLAG_MILITARY, FLAG_PIA, FLAG_LADD = 1, 4, 8
NM_KM = 1.852

# ICAO type designators to a role, for military aircraft. Unknown types
# fall back to "Military".
ROLES = {
    "K35R": "Tanker",
    "K35E": "Tanker",
    "KC46": "Tanker",
    "KC10": "Tanker",
    "A332": "Tanker",
    "MRTT": "Tanker",
    "K30J": "Tanker",
    "KC2": "Tanker",
    "R135": "ISR",
    "RC35": "ISR",
    "E8": "ISR",
    "Q4": "ISR",
    "GLEX": "ISR",
    "U2": "ISR",
    "MQ9": "ISR",
    "Q9": "ISR",
    "P8": "Patrol",
    "P3": "Patrol",
    "P1": "Patrol",
    "BE20": "ISR",
    "E3TF": "AEW&C",
    "E3CF": "AEW&C",
    "E737": "AEW&C",
    "E7": "AEW&C",
    "E2": "AEW&C",
    "E6": "Command",
    "C17": "Airlift",
    "C5M": "Airlift",
    "C130": "Airlift",
    "C30J": "Airlift",
    "A400": "Airlift",
    "C2": "Airlift",
    "KC39": "Airlift",
    "B52": "Bomber",
    "B1": "Bomber",
    "B2": "Bomber",
    "F16": "Fighter",
    "F15": "Fighter",
    "F18": "Fighter",
    "F35": "Fighter",
    "F22": "Fighter",
    "EUFI": "Fighter",
    "TORN": "Fighter",
    "H60": "Helicopter",
    "H47": "Helicopter",
    "V22": "Tiltrotor",
    "UH1": "Helicopter",
    "EC45": "Helicopter",
    "C32": "VIP",
    "C37A": "VIP",
    "C40": "VIP",
    "VC25": "VIP",
}


def role_for(type_code: str | None) -> str:
    return ROLES.get((type_code or "").upper(), "Military")


# --- reference data ----------------------------------------------------


@dataclass(frozen=True)
class Airport:
    icao: str
    iata: str
    name: str
    city: str
    cc: str
    lat: float
    lon: float
    large: bool

    def label(self) -> str:
        code = self.iata or self.icao
        return "{0} · {1}".format(code, self.name)


@dataclass(frozen=True)
class Airline:
    iata: str
    icao: str
    name: str
    callsign: str
    country: str


def _read(name: str):
    with gzip.open(os.path.join(DATA, name), "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            yield line.rstrip("\n").split("\t")


@lru_cache(maxsize=1)
def airports() -> dict[str, Airport]:
    """Keyed by ICAO and by IATA code."""
    out: dict[str, Airport] = {}
    for icao, iata, name, city, cc, lat, lon, size in _read("airports.tsv.gz"):
        a = Airport(
            icao, iata, name, city, cc, float(lat), float(lon), size == "L"
        )
        if icao:
            out[icao] = a
        if iata and iata not in out:
            out[iata] = a
    return out


@lru_cache(maxsize=1)
def airlines() -> tuple[dict[str, Airline], dict[str, Airline]]:
    """(by IATA, by ICAO)."""
    by_iata: dict[str, Airline] = {}
    by_icao: dict[str, Airline] = {}
    for iata, icao, name, callsign, country in _read("airlines.tsv.gz"):
        a = Airline(iata, icao, name, callsign, country)
        by_iata[iata] = a
        by_icao.setdefault(icao, a)
    return by_iata, by_icao


def large_airports() -> list[Airport]:
    seen, out = set(), []
    for a in airports().values():
        if a.large and a.icao not in seen:
            seen.add(a.icao)
            out.append(a)
    return out


# --- aircraft records ----------------------------------------------------


def normalise(ac: dict, military: bool | None = None) -> dict[str, Any] | None:
    """Trim an adsb.lol aircraft to what Argus shows. None = drop it."""
    if "lat" not in ac or "lon" not in ac:
        return None
    flags = int(ac.get("dbFlags") or 0)
    mil = bool(flags & FLAG_MILITARY) if military is None else military
    if not mil and flags & (FLAG_PIA | FLAG_LADD):
        return None
    alt = ac.get("alt_baro")
    on_ground = alt == "ground"
    squawk = ac.get("squawk")
    return {
        "hex": str(ac.get("hex", "")).lower(),
        "callsign": (ac.get("flight") or "").strip(),
        "reg": ac.get("r") or "",
        "type": ac.get("t") or "",
        "mil": mil,
        "role": role_for(ac.get("t")) if mil else None,
        "lat": round(float(ac["lat"]), 5),
        "lon": round(float(ac["lon"]), 5),
        "alt_ft": 0 if on_ground else (alt if isinstance(alt, int) else None),
        "ground": on_ground,
        "gs_kt": ac.get("gs"),
        "track": ac.get("track")
        if ac.get("track") is not None
        else (ac.get("true_heading")),
        "vrate": ac.get("baro_rate", ac.get("geom_rate")),
        "squawk": squawk,
        "emergency": squawk in ("7500", "7600", "7700")
        or (ac.get("emergency") not in (None, "none")),
        "seen": ac.get("seen_pos", ac.get("seen")),
        # Navigation accuracy, for GPS interference (NACp < 8 means the
        # aircraft's own position is degraded).
        "nac_p": ac.get("nac_p"),
        "source": "adsb.lol",
    }


class GpsGrid:
    """GPS interference from ADS-B, the method gpsjam.org uses: in each
    grid cell, the share of aircraft reporting a degraded position
    (NACp below 8) over the last hour. Only cells with enough aircraft
    count, and Argus sees only the aircraft it fetches (military
    worldwide, civil where someone is looking, your own receiver).
    """

    CELL_DEG = 1.0
    WINDOW_S = 3600
    MIN_AIRCRAFT = 8

    def __init__(self) -> None:
        # (cell) -> {hex: (bad, time)}
        self.cells: dict[tuple[int, int], dict[str, tuple[bool, float]]] = {}

    def observe(self, aircraft: list[dict], now: float | None = None) -> None:
        now = now or time.time()
        for a in aircraft:
            nac = a.get("nac_p")
            if nac is None or a.get("ground") or a.get("lat") is None:
                continue
            key = (
                math.floor(a["lat"] / self.CELL_DEG),
                math.floor(a["lon"] / self.CELL_DEG),
            )
            self.cells.setdefault(key, {})[a["hex"]] = (nac < 8, now)

    def summary(self, now: float | None = None) -> list[dict]:
        now = now or time.time()
        out = []
        for key in list(self.cells):
            seen = {
                h: v
                for h, v in self.cells[key].items()
                if now - v[1] <= self.WINDOW_S
            }
            if not seen:
                self.cells.pop(key, None)
                continue
            self.cells[key] = seen
            if len(seen) < self.MIN_AIRCRAFT:
                continue
            bad = sum(1 for b, _ in seen.values() if b)
            share = bad / len(seen)
            out.append(
                {
                    "lat": key[0] * self.CELL_DEG,
                    "lon": key[1] * self.CELL_DEG,
                    "size": self.CELL_DEG,
                    "aircraft": len(seen),
                    "bad": bad,
                    "share": round(share, 3),
                    "level": (
                        "high"
                        if share > 0.10
                        else "medium"
                        if share > 0.02
                        else "low"
                    ),
                }
            )
        return out


class LiveAir:
    """Latest military positions and short trails, in API memory."""

    TRAIL_POINTS = 120
    STALE_S = 120

    def __init__(self) -> None:
        self.aircraft: dict[str, dict[str, Any]] = {}
        self.trails: dict[str, deque] = {}
        self.updated = 0.0

    def apply(self, snapshot: list[dict[str, Any]], now: float | None = None):
        now = now or time.time()
        for a in snapshot:
            hex_id = a["hex"]
            a = dict(a, at=now)
            self.aircraft[hex_id] = a
            trail = self.trails.setdefault(
                hex_id, deque(maxlen=self.TRAIL_POINTS)
            )
            point = (a["lon"], a["lat"], a.get("alt_ft") or 0, now)
            if not trail or trail[-1][:2] != point[:2]:
                trail.append(point)
        for hex_id in [
            h for h, a in self.aircraft.items() if now - a["at"] > self.STALE_S
        ]:
            self.aircraft.pop(hex_id, None)
            self.trails.pop(hex_id, None)
        self.updated = now

    def in_bbox(self, bbox) -> list[dict[str, Any]]:
        if bbox is None:
            return list(self.aircraft.values())
        w, s, e, n = bbox
        out = []
        for a in self.aircraft.values():
            if not s <= a["lat"] <= n:
                continue
            if (w <= e and w <= a["lon"] <= e) or (
                w > e and (a["lon"] >= w or a["lon"] <= e)
            ):
                out.append(a)
        return out

    def find(self, query: str) -> list[dict[str, Any]]:
        q = query.strip().upper()
        return [
            a
            for a in self.aircraft.values()
            if q in (a["callsign"].upper(), a["hex"].upper(), a["reg"].upper())
        ]


# --- on-demand fetches ---------------------------------------------------


class TTLCache:
    def __init__(self, ttl_s: float, max_items: int = 2000) -> None:
        self.ttl = ttl_s
        self.max = max_items
        self.items: dict[str, tuple[float, Any]] = {}

    def get(self, key: str):
        hit = self.items.get(key)
        if hit and time.time() - hit[0] < self.ttl:
            return hit[1]
        return None

    def put(self, key: str, value: Any) -> None:
        if len(self.items) >= self.max:
            oldest = min(self.items, key=lambda k: self.items[k][0])
            self.items.pop(oldest, None)
        self.items[key] = (time.time(), value)


class RateLimited(Exception):
    """adsb.lol asked us to slow down and there's nothing cached."""


# Area queries snap to these radii (nm) and a 0.25 degree grid, so small
# pans and zooms reuse one cached answer.
RADIUS_STEPS = (25, 50, 100, 150, 200, 250)
AREA_TTL_S = 15
# How long an area answer may be served when adsb.lol is limiting us.
AREA_STALE_S = 120
# Spacing between adsb.lol requests from this API, and the pause after
# a 429 when the server doesn't say how long to wait.
MIN_GAP_S = 1.0
BACKOFF_S = 30.0


def snap_area(lat: float, lon: float, radius_nm: int) -> tuple:
    radius = next((r for r in RADIUS_STEPS if r >= radius_nm), 250)
    return round(lat * 4) / 4, round(lon * 4) / 4, radius


class AirClient:
    """adsb.lol area queries and adsbdb lookups, with caches.

    adsb.lol is a free community service with rate limits shared by
    everyone on this IP address, so requests are spaced out, a 429 pauses
    them, and recent answers are served while paused.
    """

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )
        self.areas = TTLCache(AREA_STALE_S, max_items=200)
        self.routes = TTLCache(6 * 3600)
        self.details = TTLCache(24 * 3600)
        # hex -> (time seen, aircraft), from any area answer.
        self.recent: dict[str, tuple[float, dict]] = {}
        self.gps: GpsGrid | None = None
        self.lock = asyncio.Lock()
        self.next_request = 0.0
        self.paused_until = 0.0

    async def close(self) -> None:
        await self.client.aclose()

    def limited(self) -> bool:
        return time.monotonic() < self.paused_until

    async def _adsb_get(self, path: str) -> httpx.Response:
        """GET from adsb.lol, spaced out and paused after a 429."""
        if self.limited():
            raise RateLimited()
        async with self.lock:
            wait = self.next_request - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self.next_request = time.monotonic() + MIN_GAP_S
            response = await self.client.get(ADSB_LOL + path)
        if response.status_code == 429:
            try:
                pause = float(response.headers.get("Retry-After", BACKOFF_S))
            except ValueError:
                pause = BACKOFF_S
            self.paused_until = time.monotonic() + max(5.0, pause)
            log.warning("adsb.lol rate limit; pausing {0:.0f} s".format(pause))
            raise RateLimited()
        response.raise_for_status()
        return response

    async def area(self, lat: float, lon: float, radius_nm: int) -> list[dict]:
        """Civil and military aircraft within radius_nm (max 250)."""
        lat, lon, radius = snap_area(lat, lon, radius_nm)
        key = "{0:.2f},{1:.2f},{2}".format(lat, lon, radius)
        hit = self.areas.items.get(key)
        if hit and time.time() - hit[0] < AREA_TTL_S:
            return hit[1]
        try:
            response = await self._adsb_get(
                "point/{0:.2f}/{1:.2f}/{2}".format(lat, lon, radius)
            )
        except (RateLimited, httpx.HTTPError):
            if hit and time.time() - hit[0] < AREA_STALE_S:
                return hit[1]
            raise
        out = [
            a
            for a in (normalise(x) for x in response.json().get("ac", []))
            if a is not None
        ]
        self.areas.put(key, out)
        if self.gps is not None:
            self.gps.observe(out)
        now = time.time()
        for a in out:
            self.recent[a["hex"]] = (now, a)
        if len(self.recent) > 20000:
            cutoff = now - AREA_STALE_S
            self.recent = {
                h: v for h, v in self.recent.items() if v[0] > cutoff
            }
        return out

    def find_recent(self, query: str, max_age_s: float = 60) -> list[dict]:
        """Aircraft from recent area answers matching a callsign, hex or
        registration, so search works while adsb.lol is limiting us."""
        q = query.strip().upper()
        cutoff = time.time() - max_age_s
        return [
            a
            for seen, a in self.recent.values()
            if seen > cutoff
            and q
            in (a["callsign"].upper(), a["hex"].upper(), a["reg"].upper())
        ]

    def seen_recently(self, hex_id: str, max_age_s: float = 30) -> dict | None:
        hit = self.recent.get(hex_id)
        if hit and time.time() - hit[0] < max_age_s:
            return hit[1]
        return None

    async def lookup(self, kind: str, value: str) -> list[dict]:
        """adsb.lol by callsign, hex or reg (for search and selection)."""
        path = {"callsign": "callsign", "hex": "hex", "reg": "reg"}[kind]
        try:
            response = await self._adsb_get("{0}/{1}".format(path, value))
        except (RateLimited, httpx.HTTPStatusError):
            return []
        return [
            a
            for a in (normalise(x) for x in response.json().get("ac", []))
            if a is not None
        ]

    async def route_legs(self, callsign: str) -> list[dict]:
        """Every leg on file for a callsign, from adsbdb and hexdb.

        Airlines reuse flight numbers across legs and days, and each
        database keeps a different version, so both are asked; pick_route
        then chooses the leg that fits where the aircraft is.
        """
        callsign = callsign.strip().upper()
        if not callsign:
            return []
        cached = self.routes.get(callsign)
        if cached is not None:
            return cached
        legs: list[dict] = []
        try:
            response = await self.client.get(
                "{0}callsign/{1}".format(ADSBDB, callsign)
            )
            if response.status_code == 200:
                fr = (response.json().get("response") or {}).get(
                    "flightroute"
                ) or {}
                if fr:
                    legs.append(
                        {
                            "callsign": fr.get("callsign_icao") or callsign,
                            "flight": fr.get("callsign_iata"),
                            "airline": (fr.get("airline") or {}).get("name"),
                            "origin": _airport(fr.get("origin")),
                            "destination": _airport(fr.get("destination")),
                            "source": "adsbdb",
                        }
                    )
        except httpx.HTTPError as exc:
            log.warning("adsbdb route lookup failed: {0}".format(exc))
        try:
            response = await self.client.get(
                HEXDB_ROUTE, params={"callsign": callsign}
            )
            text = response.text.strip() if response.status_code == 200 else ""
            codes = [c for c in text.split("-") if len(c) == 4 and c.isalnum()]
            flight = legs[0]["flight"] if legs else None
            airline = legs[0]["airline"] if legs else None
            for a, b in zip(codes, codes[1:], strict=False):
                o, d = airports().get(a.upper()), airports().get(b.upper())
                if o and d and o.icao != d.icao:
                    legs.append(
                        {
                            "callsign": callsign,
                            "flight": flight,
                            "airline": airline,
                            "origin": _bundled_airport(o),
                            "destination": _bundled_airport(d),
                            "source": "hexdb",
                        }
                    )
        except httpx.HTTPError as exc:
            log.warning("hexdb route lookup failed: {0}".format(exc))
        self.routes.put(callsign, legs)
        return legs

    async def detail(self, hex_id: str) -> dict | None:
        hex_id = hex_id.strip().lower()
        cached = self.details.get(hex_id)
        if cached is not None:
            return cached or None
        response = await self.client.get(
            "{0}aircraft/{1}".format(ADSBDB, hex_id)
        )
        detail: dict = {}
        if response.status_code == 200:
            ac = (response.json().get("response") or {}).get("aircraft") or {}
            if ac:
                # Owner names are deliberately left out.
                detail = {
                    "type": ac.get("type"),
                    "icao_type": ac.get("icao_type"),
                    "manufacturer": ac.get("manufacturer"),
                    "registration": ac.get("registration"),
                    "country": ac.get("registered_owner_country_name"),
                }
        self.details.put(hex_id, detail)
        return detail or None


def _airport(a: dict | None) -> dict | None:
    if not a:
        return None
    return {
        "iata": a.get("iata_code"),
        "icao": a.get("icao_code"),
        "name": a.get("name"),
        "city": a.get("municipality"),
        "lat": a.get("latitude"),
        "lon": a.get("longitude"),
    }


def _bundled_airport(a: Airport) -> dict:
    return {
        "iata": a.iata or None,
        "icao": a.icao,
        "name": a.name,
        "city": a.city,
        "lat": a.lat,
        "lon": a.lon,
    }


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(
        dl
    )
    return (math.degrees(math.atan2(y, x)) + 360) % 360


MAX_TURN_DEG = 60


def pick_route(
    legs: list[dict], lat: float, lon: float, track: float | None
) -> tuple[dict | None, dict | None]:
    """The leg that best fits the aircraft, and its progress.

    A leg fits when the aircraft is near the line between its airports
    (route_progress's plausibility) and, while cruising, is heading within
    MAX_TURN_DEG of the destination's bearing. Returns the best-fitting leg
    even if none fits, with progress["plausible"] False.
    """
    best = None
    for leg in legs:
        progress = route_progress(leg, lat, lon)
        if progress is None:
            continue
        d = leg["destination"]
        detour = (progress["flown_km"] + progress["remaining_km"]) / max(
            1, progress["total_km"]
        )
        turn = 0.0
        # Away from departure and arrival (where aircraft turn onto and off
        # their airways), they head within about 60 degrees of the
        # destination's bearing.
        cruising = (
            progress["flown_km"] > 150 and progress["remaining_km"] > 150
        )
        if track is not None and cruising:
            to_dest = bearing_deg(lat, lon, d["lat"], d["lon"])
            turn = abs((track - to_dest + 540) % 360 - 180)
            if turn > MAX_TURN_DEG:
                progress = dict(progress, plausible=False)
        score = (0 if progress["plausible"] else 10) + detour + turn / 180
        if best is None or score < best[0]:
            best = (score, leg, progress)
    if best is None:
        return (legs[0] if legs else None), None
    return best[1], best[2]


def route_progress(route: dict, lat: float, lon: float) -> dict | None:
    """Distance flown and remaining along a great circle, in km."""
    o, d = route.get("origin"), route.get("destination")
    if not o or not d or o.get("lat") is None or d.get("lat") is None:
        return None
    total = distance_km(o["lat"], o["lon"], d["lat"], d["lon"])
    remaining = distance_km(lat, lon, d["lat"], d["lon"])
    if total <= 0:
        return None
    flown = distance_km(o["lat"], o["lon"], lat, lon)
    # Route databases go stale when airlines reuse flight numbers. If the
    # aircraft is well off the line between the two airports, the route
    # on file isn't this flight's.
    plausible = flown + remaining <= total * 1.3 + 150
    done = max(0.0, min(1.0, 1 - remaining / total))
    return {
        "total_km": round(total),
        "remaining_km": round(remaining),
        "flown_km": round(flown),
        "fraction": round(done, 3),
        "plausible": plausible,
    }


def radius_for_bbox(bbox) -> tuple[float, float, int] | None:
    """Centre and adsb.lol radius (nm) covering a bbox, if small enough.

    Civil traffic is only fetched once the view is regional (a radius up
    to 250 nm); a whole-world view shows military aircraft only.
    """
    w, s, e, n = bbox
    if w > e:
        e += 360
    lat = (s + n) / 2
    lon = ((w + e) / 2 + 180) % 360 - 180
    half_km = distance_km(lat, lon, n, e if e <= 180 else e - 360)
    radius_nm = int(half_km / NM_KM) + 1
    if radius_nm > 400:
        return None
    return lat, lon, min(250, radius_nm)
