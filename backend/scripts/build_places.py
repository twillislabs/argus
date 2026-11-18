"""Build argus/data/places.tsv.gz from GeoNames dumps.

Download from https://download.geonames.org/export/dump/ :
    cities15000.zip  admin1CodesASCII.txt  countryInfo.txt

Usage:
    python scripts/build_places.py <dir with the three files>

GeoNames data is CC BY 4.0 (https://www.geonames.org/). The output keeps
places with 15,000+ people (plus capitals), which is about 34,000 rows.
"""

import gzip
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "argus", "data", "places.tsv.gz")


def read_admin1(path):
    names = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2:
                names[parts[0]] = parts[1]
    return names


def read_countries(path):
    names = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) > 4:
                names[parts[0]] = parts[4]
    return names


def main(src):
    admin1 = read_admin1(os.path.join(src, "admin1CodesASCII.txt"))
    countries = read_countries(os.path.join(src, "countryInfo.txt"))
    with zipfile.ZipFile(os.path.join(src, "cities15000.zip")) as z:
        text = z.read("cities15000.txt").decode("utf-8")
    rows = []
    for line in text.splitlines():
        r = line.split("\t")
        cc = r[8]
        region = admin1.get("{0}.{1}".format(cc, r[10]), "")
        rows.append(
            "\t".join(
                [
                    r[1],
                    r[2],
                    region,
                    cc,
                    countries.get(cc, cc),
                    "{0:.5f}".format(float(r[4])),
                    "{0:.5f}".format(float(r[5])),
                    r[14] or "0",
                    r[17],
                ]
            )
        )
    header = "name\tascii\tregion\tcc\tcountry\tlat\tlon\tpopulation\ttz\n"
    with gzip.open(OUT, "wt", encoding="utf-8", compresslevel=9) as f:
        f.write(header)
        f.write("\n".join(rows))
        f.write("\n")
    print("wrote {0} places to {1}".format(len(rows), OUT))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
