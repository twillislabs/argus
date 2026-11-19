"""Build argus/data/conflict.tsv.gz: deaths from organised violence per
country over the last twelve months of UCDP data, and the twelve before.

The tension index uses this as each country's standing level, so it
lines up with conflict indexes built on the same kind of data (ACLED,
UCDP, the Global Peace Index), and live events move it from there.

Sources (UCDP, Uppsala University; CC BY 4.0, cite UCDP):
- GED Global (all events to the end of the last full year):
  https://ucdp.uu.se/downloads/ged/ged261-csv.zip
- Candidate Events, cumulative for the current year:
  https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_09.csv

    python scripts/build_conflict.py ged261-csv.zip GEDEvent_v26_01_26_09.csv

All three kinds of violence count: state-based, non-state and one-sided.
Deaths are UCDP's "best" estimate. Events in Gaza and the West Bank
(coded under Israel) are counted as Palestine.
"""

import csv
import gzip
import io
import os
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "argus", "data", "conflict.tsv.gz")

# UCDP's historical names to the names Argus uses (GeoNames / GDELT).
NAMES = {
    "DR Congo (Zaire)": "Democratic Republic of the Congo",
    "Russia (Soviet Union)": "Russia",
    "Myanmar (Burma)": "Myanmar",
    "Yemen (North Yemen)": "Yemen",
    "Cambodia (Kampuchea)": "Cambodia",
    "Zimbabwe (Rhodesia)": "Zimbabwe",
    "Serbia (Yugoslavia)": "Serbia",
    "Madagascar (Malagasy)": "Madagascar",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Ivory Coast": "Côte d'Ivoire",
    "Kingdom of eSwatini (Swaziland)": "eSwatini",
    "Congo": "Republic of the Congo",
    "Macedonia, FYR": "North Macedonia",
}
PALESTINE_ADM = ("Gaza Strip", "West Bank")


def month_index(date: str) -> int:
    return int(date[:4]) * 12 + int(date[5:7]) - 1


def rows(paths: list[str]):
    csv.field_size_limit(10**9)
    for path in paths:
        if path.endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                name = next(n for n in z.namelist() if n.endswith(".csv"))
                with z.open(name) as f:
                    yield from csv.DictReader(
                        io.TextIOWrapper(f, encoding="utf-8")
                    )
        else:
            with open(path, encoding="utf-8") as f:
                yield from csv.DictReader(f)


def country_of(row: dict) -> str:
    name = row["country"]
    if name == "Israel" and row.get("adm_1") in PALESTINE_ADM:
        return "Palestine"
    return NAMES.get(name, name)


def main(paths: list[str]) -> None:
    # (country, month) -> [deaths, events]; candidate rows that repeat a
    # GED id are counted once.
    totals: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0])
    seen: set[str] = set()
    latest = 0
    for row in rows(paths):
        key = row.get("id") or ""
        if key and key in seen:
            continue
        seen.add(key)
        month = month_index(row["date_start"])
        latest = max(latest, month)
        cell = totals[(country_of(row), month)]
        cell[0] += int(float(row.get("best") or 0))
        cell[1] += 1
    recent = range(latest - 11, latest + 1)
    before = range(latest - 23, latest - 11)
    out: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for (country, month), (deaths, events) in totals.items():
        if month in recent:
            out[country][0] += deaths
            out[country][2] += events
        elif month in before:
            out[country][1] += deaths
    through = "{0}-{1:02d}".format(latest // 12, latest % 12 + 1)
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        f.write("# UCDP GED + Candidate Events (CC BY 4.0), through ")
        f.write(through + "\n")
        f.write("country\tdeaths_12m\tdeaths_prev_12m\tevents_12m\n")
        for country, (d12, dprev, ev) in sorted(
            out.items(), key=lambda kv: -kv[1][0]
        ):
            if d12 or dprev:
                row = (country, d12, dprev, ev)
                f.write("{0}\t{1}\t{2}\t{3}\n".format(*row))
    print(
        "wrote {0}: {1} countries through {2}".format(OUT, len(out), through)
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
