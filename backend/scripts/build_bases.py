"""Build frontend/public/data/bases.json from an OpenStreetMap Overpass
result of named military sites (ODbL; credit OpenStreetMap contributors).

Query (overpass-api.de; heavy, so run rarely):

    [out:json][timeout:600];
    (nwr["military"~"^(base|airfield|naval_base|range|training_area|barracks)$"]["name"];);
    out center tags;

Usage:
    python scripts/build_bases.py <overpass.json>

Output rows: [name, kind, lon, lat, operator].
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(
    HERE, "..", "..", "frontend", "public", "data", "bases.json"
)
KINDS = {
    "base",
    "airfield",
    "naval_base",
    "range",
    "training_area",
    "barracks",
}


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    rows, seen = [], set()
    for e in doc.get("elements", []):
        tags = e.get("tags") or {}
        kind = tags.get("military")
        name = (tags.get("name:en") or tags.get("name") or "").strip()
        point = e if "lat" in e else e.get("center")
        if kind not in KINDS or not name or not point:
            continue
        lat, lon = round(point["lat"], 4), round(point["lon"], 4)
        key = (name.lower(), round(lat, 2), round(lon, 2))
        if key in seen:
            continue
        seen.add(key)
        rows.append([name, kind, lon, lat, (tags.get("operator") or "")[:60]])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    kinds = {}
    for r in rows:
        kinds[r[1]] = kinds.get(r[1], 0) + 1
    print("wrote {0} sites: {1}".format(len(rows), kinds))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
