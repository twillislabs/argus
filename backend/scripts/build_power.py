"""Build frontend/public/data/power.json from the WRI Global Power Plant
Database (CC BY 4.0, last release v1.3.0, 2021).

    python scripts/build_power.py <global_power_plant_database.csv>

Keeps every nuclear plant and other plants of 300 MW or more.
Output rows: [name, country (ISO3), fuel, capacity MW, lon, lat].
"""

import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(
    HERE, "..", "..", "frontend", "public", "data", "power.json"
)
MIN_MW = 300


def main(path: str) -> None:
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                mw = float(r["capacity_mw"])
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except ValueError:
                continue
            fuel = r["primary_fuel"]
            if fuel != "Nuclear" and mw < MIN_MW:
                continue
            rows.append(
                [
                    r["name"].strip(),
                    r["country"],
                    fuel,
                    round(mw),
                    round(lon, 4),
                    round(lat, 4),
                ]
            )
    rows.sort(key=lambda x: -x[3])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    fuels = {}
    for r in rows:
        fuels[r[2]] = fuels.get(r[2], 0) + 1
    print("wrote {0} plants: {1}".format(len(rows), fuels))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
