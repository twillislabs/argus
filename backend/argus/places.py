"""Offline place search over GeoNames cities (15,000+ people).

Data: argus/data/places.tsv.gz, built by scripts/build_places.py from
GeoNames (CC BY 4.0, https://www.geonames.org/). Loaded once, on first
use, into memory (about 34,000 rows).
"""

import gzip
import os
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from argus.geo import distance_km

DATA = os.path.join(os.path.dirname(__file__), "data", "places.tsv.gz")

US_STATES = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
    "DC": "Washington, D.C.",
}


@dataclass(frozen=True)
class Place:
    name: str
    region: str
    cc: str
    country: str
    lat: float
    lon: float
    population: int
    tz: str
    key: str  # folded name, for matching
    region_key: str
    country_key: str

    def label(self) -> str:
        parts = [self.name]
        if self.region and self.region != self.name:
            parts.append(self.region)
        parts.append(self.country)
        return ", ".join(parts)


def fold(text: str) -> str:
    """Lower-case, strip accents and punctuation (São Paulo: sao paulo)."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = "".join(c if c.isalnum() else " " for c in plain.lower())
    return " ".join(cleaned.split())


@lru_cache(maxsize=1)
def load(path: str = DATA) -> tuple[Place, ...]:
    places = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        next(f)  # header
        for line in f:
            name, ascii_name, region, cc, country, lat, lon, pop, tz = (
                line.rstrip("\n").split("\t")
            )
            places.append(
                Place(
                    name=name,
                    region=region,
                    cc=cc,
                    country=country,
                    lat=float(lat),
                    lon=float(lon),
                    population=int(pop or 0),
                    tz=tz,
                    key=fold(ascii_name or name),
                    region_key=fold(region),
                    country_key=fold(country),
                )
            )
    return tuple(places)


def _split_query(query: str) -> tuple[str, list[str]]:
    """'Goodlettsville, TN' -> ('goodlettsville', ['tennessee'])."""
    pieces = [p.strip() for p in query.split(",") if p.strip()]
    if not pieces:
        return "", []
    qualifiers = []
    for piece in pieces[1:]:
        upper = piece.upper()
        qualifiers.append(fold(US_STATES.get(upper, piece)))
    return fold(pieces[0]), [q for q in qualifiers if q]


def search(query: str, limit: int = 10) -> list[Place]:
    """Rank: exact name, then name prefix, then word prefix, then contains.

    Ties go to the larger population. A qualifier after a comma ("TN",
    "Tennessee", "Poland") must match the region, country or country code.
    """
    name_q, qualifiers = _split_query(query)
    if len(name_q) < 2:
        return []
    scored = []
    for p in load():
        if name_q == p.key:
            rank = 0
        elif p.key.startswith(name_q):
            rank = 1
        elif " {0}".format(name_q) in " {0}".format(p.key):
            rank = 2
        elif name_q in p.key:
            rank = 3
        else:
            continue
        if qualifiers and not all(
            q in p.region_key or q in p.country_key or q == p.cc.lower()
            for q in qualifiers
        ):
            continue
        scored.append((rank, -p.population, p))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [p for _, _, p in scored[:limit]]


@lru_cache(maxsize=1)
def _grid() -> dict[tuple[int, int], list[Place]]:
    grid: dict[tuple[int, int], list[Place]] = {}
    for p in load():
        grid.setdefault((int(p.lat // 1), int(p.lon // 1)), []).append(p)
    return grid


def nearest(lat: float, lon: float, max_km: float = 75) -> Place | None:
    """The closest listed place within max_km, or None."""
    best, best_d = None, max_km
    gi, gj = int(lat // 1), int(lon // 1)
    grid = _grid()
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for p in grid.get((gi + di, (gj + dj + 180) % 360 - 180), ()):
                d = distance_km(lat, lon, p.lat, p.lon)
                if d < best_d:
                    best, best_d = p, d
    return best


def largest_near(
    lat: float, lon: float, radius_km: float, limit: int = 3
) -> list[Place]:
    """The most populous listed places within radius_km, biggest first."""
    reach = int(radius_km / 111) + 1
    gi, gj = int(lat // 1), int(lon // 1)
    grid = _grid()
    found = []
    for di in range(-reach, reach + 1):
        for dj in range(-reach, reach + 1):
            cell = (gi + di, (gj + dj + 180) % 360 - 180)
            for p in grid.get(cell, ()):
                if distance_km(lat, lon, p.lat, p.lon) <= radius_km:
                    found.append(p)
    found.sort(key=lambda p: -p.population)
    out, seen = [], set()
    for p in found:
        # "Paris 15 Vaugirard" adds nothing to "Paris".
        if any(p.key == k or p.key.startswith(k + " ") for k in seen):
            continue
        seen.add(p.key)
        out.append(p)
        if len(out) >= limit:
            break
    return out
