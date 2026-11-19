"""Build the map's label and airport overlays from the bundled data.

Writes frontend/public/data/cities.json (places of 200,000+ people, from
GeoNames, CC BY 4.0) and airports.json (large airports, OurAirports,
public domain). Run after build_places.py or build_aviation.py:

    python scripts/build_labels.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from argus import places  # noqa: E402
from argus.aviation import large_airports  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "frontend", "public", "data")
MIN_POPULATION = 200_000


def main() -> None:
    cities = sorted(
        (p for p in places.load() if p.population >= MIN_POPULATION),
        key=lambda p: -p.population,
    )
    rows = [
        [p.name, round(p.lon, 3), round(p.lat, 3), p.population]
        for p in cities
    ]
    with open(os.path.join(OUT, "cities.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote {0} cities".format(len(rows)))

    airports = [
        [a.iata or a.icao, a.name, round(a.lon, 4), round(a.lat, 4)]
        for a in large_airports()
    ]
    with open(os.path.join(OUT, "airports.json"), "w", encoding="utf-8") as f:
        json.dump(airports, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote {0} airports".format(len(airports)))


if __name__ == "__main__":
    main()
