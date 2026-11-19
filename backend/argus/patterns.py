"""Behaviour patterns, worked out by the API from what it already holds:

- Air: military aircraft flying an orbit or a racetrack (tankers, AWACS,
  surveillance), from their trails in LiveAir (about the last hour):
  1.5 turns or more within ORBIT_RADIUS_KM over the last 45 minutes.
- Sea: ships loitering near a submarine cable: two hours or more within
  LOITER_RADIUS_KM, slow, within CABLE_KM of a cable, and not next to a
  town (harbours and anchorages), from the short tracks LiveSea keeps.

Indicators to look at, not conclusions: aircraft train in circuits and
ships wait out weather.
"""

import math
import time
from collections import defaultdict

from argus import places
from argus.geo import distance_km

AIR_WINDOW_S = 45 * 60
MIN_TURN_DEG = 540
ORBIT_RADIUS_KM = 40
MIN_ALT_FT = 3000
LOITER_S = 2 * 3600
LOITER_RADIUS_KM = 3
LOITER_MAX_SOG = 3
CABLE_KM = 10
HARBOUR_KM = 8
CELL_DEG = 0.5


def _bearing(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(
        dl
    )
    return math.degrees(math.atan2(y, x)) % 360


def _centre(points) -> tuple[float, float]:
    return (
        sum(p[1] for p in points) / len(points),
        sum(p[0] for p in points) / len(points),
    )


def track_shape(points) -> dict | None:
    """Turning and size of a track of (lon, lat, ...) points."""
    moves = []
    for a, b in zip(points, points[1:], strict=False):
        if distance_km(a[1], a[0], b[1], b[0]) >= 0.2:
            moves.append(_bearing(a[1], a[0], b[1], b[0]))
    if len(moves) < 8:
        return None
    turn = 0.0
    for h1, h2 in zip(moves, moves[1:], strict=False):
        turn += (h2 - h1 + 540) % 360 - 180
    lat, lon = _centre(points)
    dists = [distance_km(lat, lon, p[1], p[0]) for p in points]
    radius = max(dists)
    mean = sum(dists) / len(dists)
    return {
        "turn_deg": abs(turn),
        "lat": lat,
        "lon": lon,
        "radius_km": radius,
        # A circle's points sit near its mean distance; a racetrack's ends
        # reach well past it.
        "elongation": radius / mean if mean else 1.0,
    }


def air_patterns(live_air, now: float | None = None) -> list[dict]:
    now = now or time.time()
    out = []
    for hex_id, trail in live_air.trails.items():
        a = live_air.aircraft.get(hex_id)
        if not a or not a.get("mil"):
            continue
        pts = [p for p in trail if now - p[3] <= AIR_WINDOW_S]
        if len(pts) < 20 or pts[-1][3] - pts[0][3] < 15 * 60:
            continue
        if min(p[2] or 0 for p in pts) < MIN_ALT_FT:
            continue
        shape = track_shape(pts)
        if not shape or shape["turn_deg"] < MIN_TURN_DEG:
            continue
        if shape["radius_km"] > ORBIT_RADIUS_KM:
            continue
        out.append(
            {
                "kind": "racetrack" if shape["elongation"] > 1.6 else "orbit",
                "hex": hex_id,
                "callsign": a.get("callsign"),
                "type": a.get("type"),
                "role": a.get("role"),
                "lat": round(shape["lat"], 4),
                "lon": round(shape["lon"], 4),
                "radius_km": round(shape["radius_km"], 1),
                "laps": round(shape["turn_deg"] / 360, 1),
                "minutes": round((pts[-1][3] - pts[0][3]) / 60),
                "alt_ft": a.get("alt_ft"),
                "near": _near(shape["lat"], shape["lon"]),
            }
        )
    return sorted(out, key=lambda p: -p["laps"])


def _near(lat: float, lon: float) -> str | None:
    p = places.nearest(lat, lon, 150)
    return p.label() if p else None


class CableIndex:
    """Cable segments in a coarse grid, for distance-to-cable checks."""

    def __init__(self, geojson: dict) -> None:
        self.cells: dict[tuple[int, int], list] = defaultdict(list)
        for f in (geojson or {}).get("features") or []:
            geom = f.get("geometry") or {}
            name = (f.get("properties") or {}).get("name") or "Cable"
            lines = geom.get("coordinates") or []
            if geom.get("type") == "LineString":
                lines = [lines]
            for line in lines:
                for a, b in zip(line, line[1:], strict=False):
                    seg = (a[0], a[1], b[0], b[1], name)
                    for cell in self._cells(seg):
                        self.cells[cell].append(seg)

    @staticmethod
    def _cells(seg):
        x0, x1 = sorted((seg[0], seg[2]))
        y0, y1 = sorted((seg[1], seg[3]))
        if x1 - x0 > 20:  # crosses the antimeridian: skip, rare
            return []
        return [
            (i, j)
            for i in range(int(y0 // CELL_DEG), int(y1 // CELL_DEG) + 1)
            for j in range(int(x0 // CELL_DEG), int(x1 // CELL_DEG) + 1)
        ]

    def nearest(self, lat: float, lon: float) -> tuple[float, str] | None:
        ci, cj = int(lat // CELL_DEG), int(lon // CELL_DEG)
        best = None
        kx = 111.32 * math.cos(math.radians(lat))
        for i in (ci - 1, ci, ci + 1):
            for j in (cj - 1, cj, cj + 1):
                for x1, y1, x2, y2, name in self.cells.get((i, j), ()):
                    d = _seg_km(lon, lat, x1, y1, x2, y2, kx)
                    if best is None or d < best[0]:
                        best = (d, name)
        return best


def _seg_km(px, py, x1, y1, x2, y2, kx) -> float:
    """Distance from a point to a segment, flat-earth (fine within ~50 km)."""
    ax, ay = (x1 - px) * kx, (y1 - py) * 111.32
    bx, by = (x2 - px) * kx, (y2 - py) * 111.32
    dx, dy = bx - ax, by - ay
    t = (
        0.0
        if dx == dy == 0
        else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    )
    return math.hypot(ax + t * dx, ay + t * dy)


def sea_patterns(
    live_sea, cables: CableIndex | None, now: float | None = None
) -> list[dict]:
    now = now or time.time()
    out = []
    if cables is None:
        return out
    for mmsi, track in live_sea.tracks.items():
        v = live_sea.vessels.get(mmsi)
        if not v or len(track) < 6:
            continue
        if now - track[-1][2] > 1800 or track[-1][2] - track[0][2] < LOITER_S:
            continue
        if (v.get("sog") or 0) > LOITER_MAX_SOG or v.get("status") == "Moored":
            continue
        span = [p for p in track if track[-1][2] - p[2] <= LOITER_S * 2]
        lat, lon = _centre(span)
        if (
            max(distance_km(lat, lon, p[1], p[0]) for p in span)
            > LOITER_RADIUS_KM
        ):
            continue
        hit = cables.nearest(lat, lon)
        if not hit or hit[0] > CABLE_KM:
            continue
        if places.nearest(lat, lon, HARBOUR_KM):
            continue
        out.append(
            {
                "kind": "loiter_cable",
                "mmsi": mmsi,
                "name": v.get("name"),
                "status": v.get("status"),
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "hours": round((span[-1][2] - span[0][2]) / 3600, 1),
                "cable": hit[1],
                "cable_km": round(hit[0], 1),
                "near": _near(lat, lon),
            }
        )
    return sorted(out, key=lambda p: p["cable_km"])
