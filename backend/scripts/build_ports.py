"""Build frontend/public/data/ports.json from UN/LOCODE.

Source: UN/LOCODE (UNECE), via the datasets/un-locode mirror's
data/code-list.csv (UNECE blocks automated downloads).

Usage:
    python scripts/build_ports.py <code-list.csv>

Keeps locations with the port function (1) and coordinates, and marks
each as a sea port (within 60 km of the Natural Earth 50m coastline, so
ports up estuaries and ship channels count) or
an inland port. Output rows: [locode, name, country, lon, lat, sea].
"""

import csv
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "..", "..", "frontend", "public", "data")
SEA_KM = 60


def coordinate(text: str) -> tuple[float, float] | None:
    """'4230N 00131E' (ddmm, dddmm) to (lat, lon)."""
    parts = text.split()
    if len(parts) != 2:
        return None
    lat_s, lon_s = parts
    try:
        lat = int(lat_s[:2]) + int(lat_s[2:4]) / 60
        lon = int(lon_s[:3]) + int(lon_s[3:5]) / 60
    except ValueError:
        return None
    if lat_s[-1] == "S":
        lat = -lat
    if lon_s[-1] == "W":
        lon = -lon
    if abs(lat) > 90 or abs(lon) > 180:
        return None
    return lat, lon


def coast_points() -> dict[tuple[int, int], list[tuple[float, float]]]:
    """Coastline vertices of the 50m countries, bucketed by degree."""
    with open(
        os.path.join(PUBLIC, "countries-50m.json"), encoding="utf-8"
    ) as f:
        topo = json.load(f)
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    # Coastline arcs belong to one country; borders are shared by two.
    uses: dict[int, int] = {}

    def walk(arcs):
        for item in arcs:
            if isinstance(item, list):
                walk(item)
            else:
                i = item if item >= 0 else ~item
                uses[i] = uses.get(i, 0) + 1

    for geometry in topo["objects"]["countries"]["geometries"]:
        walk(geometry.get("arcs", []))
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for index, arc in enumerate(topo["arcs"]):
        coast = uses.get(index, 0) == 1
        x = y = 0
        for dx, dy in arc:
            x += dx
            y += dy
            if not coast:
                continue
            lon, lat = x * sx + tx, y * sy + ty
            key = (math.floor(lat), math.floor(lon))
            grid.setdefault(key, []).append((lat, lon))
    return grid


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    )
    return 2 * 6371 * math.asin(min(1, math.sqrt(h)))


def near_coast(grid, lat: float, lon: float) -> bool:
    for dlat in (-1, 0, 1):
        for dlon in (-1, 0, 1):
            key = (math.floor(lat) + dlat, math.floor(lon) + dlon)
            for p in grid.get(key, ()):
                if km((lat, lon), p) <= SEA_KM:
                    return True
    return False


def main(path: str) -> None:
    grid = coast_points()
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["Function"].startswith("1") or r["Status"] == "XX":
                continue
            c = coordinate(r["Coordinates"].strip())
            if c is None:
                continue
            lat, lon = c
            rows.append(
                [
                    r["Country"] + r["Location"],
                    r["NameWoDiacritics"] or r["Name"],
                    r["Country"],
                    round(lon, 3),
                    round(lat, 3),
                    1 if near_coast(grid, lat, lon) else 0,
                ]
            )
    with open(os.path.join(PUBLIC, "ports.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    sea = sum(r[5] for r in rows)
    print(
        "wrote {0} ports ({1} sea, {2} inland)".format(
            len(rows), sea, len(rows) - sea
        )
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
