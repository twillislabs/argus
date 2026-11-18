"""Build argus/data/airports.tsv.gz and airlines.tsv.gz.

Sources:
    airports.csv  OurAirports, public domain
                  https://davidmegginson.github.io/ourairports-data/
    airlines.dat  OpenFlights, ODbL 1.0
                  https://github.com/jpatokal/openflights/tree/master/data

Usage:
    python scripts/build_aviation.py <dir with airports.csv and airlines.dat>

Keeps large and medium airports that have an ICAO or IATA code, and
airlines that have both codes (active ones first when a code is reused).
"""

import csv
import gzip
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "argus", "data")
KEEP = {"large_airport", "medium_airport"}


def airports(src):
    rows = []
    with open(os.path.join(src, "airports.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["type"] not in KEEP:
                continue
            icao = r["icao_code"] or (
                r["ident"] if len(r["ident"]) == 4 else ""
            )
            iata = r["iata_code"]
            if not (icao or iata):
                continue
            rows.append(
                "\t".join(
                    [
                        icao,
                        iata,
                        r["name"].replace("\t", " "),
                        r["municipality"].replace("\t", " "),
                        r["iso_country"],
                        "{0:.5f}".format(float(r["latitude_deg"])),
                        "{0:.5f}".format(float(r["longitude_deg"])),
                        "L" if r["type"] == "large_airport" else "M",
                    ]
                )
            )
    header = "icao\tiata\tname\tcity\tcc\tlat\tlon\tsize\n"
    path = os.path.join(DATA, "airports.tsv.gz")
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        f.write(header + "\n".join(rows) + "\n")
    print("wrote {0} airports".format(len(rows)))


def airlines(src):
    best = {}
    with open(os.path.join(src, "airlines.dat"), encoding="utf-8") as f:
        for r in csv.reader(f):
            if len(r) < 8:
                continue
            name, iata, icao, callsign, country, active = (
                r[1],
                r[3],
                r[4],
                r[5],
                r[6],
                r[7],
            )
            if len(iata) != 2 or len(icao) != 3 or not icao.isalpha():
                continue
            if "\\N" in (iata, icao):
                continue
            score = 1 if active == "Y" else 0
            current = best.get(iata)
            if current is None or score > current[0]:
                best[iata] = (score, icao, name, callsign, country)
    rows = [
        "\t".join([iata, icao, name, callsign.replace("\\N", ""), country])
        for iata, (_, icao, name, callsign, country) in sorted(best.items())
    ]
    path = os.path.join(DATA, "airlines.tsv.gz")
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        f.write("iata\ticao\tname\tcallsign\tcountry\n")
        f.write("\n".join(rows) + "\n")
    print("wrote {0} airlines".format(len(rows)))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    airports(sys.argv[1])
    airlines(sys.argv[1])
