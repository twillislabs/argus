"""GDELT 2.0 events: conflict and protest, every 15 minutes.

Index: https://data.gdeltproject.org/gdeltv2/lastupdate.txt
Licence: GDELT data is free for any use with attribution
(https://www.gdeltproject.org/about.html#termsofuse).

GDELT is machine-coded from news text, so single records are noisy (a court
case or a hotel fire can be coded as "military force"). Records are kept
as raw evidence; fusion only promotes clusters that several outlets report.
"""

import csv
import io
import zipfile
from datetime import UTC, datetime, timedelta

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

INDEX = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"
FILE = "https://data.gdeltproject.org/gdeltv2/{0}.export.CSV.zip"
STAMP = "%Y%m%d%H%M%S"

# Column positions in the 61-column GDELT 2.0 event export.
C_ID, C_ACTOR1, C_ACTOR2, C_ROOT_FLAG = 0, 6, 16, 25
C_CODE, C_ROOT = 26, 28
C_GOLDSTEIN, C_MENTIONS, C_SOURCES, C_ARTICLES, C_TONE = 30, 31, 32, 33, 34
C_GEO_TYPE, C_GEO_NAME, C_GEO_CC, C_LAT, C_LON = 51, 52, 53, 56, 57
C_ADDED, C_URL = 59, 60

# CAMEO root codes we keep, mapped to Argus event types.
ROOTS = {"14": "unrest", "18": "conflict", "19": "conflict", "20": "conflict"}
# ActionGeo types precise enough to map: 3 = US city, 4 = world city.
CITY_LEVEL = {"3", "4"}

LABELS = {
    "14": "Protest",
    "140": "Protest",
    "141": "Demonstration or rally",
    "142": "Hunger strike",
    "143": "Strike or boycott",
    "144": "Blockade or obstruction",
    "145": "Violent protest or riot",
    "18": "Assault",
    "180": "Assault",
    "181": "Abduction or hostage-taking",
    "182": "Physical assault",
    "183": "Bombing",
    "1831": "Suicide bombing",
    "1832": "Vehicle bombing",
    "1833": "Roadside bombing",
    "184": "Use of human shields",
    "185": "Assassination attempt",
    "186": "Assassination",
    "19": "Armed clash",
    "190": "Use of military force",
    "191": "Blockade",
    "192": "Occupation of territory",
    "193": "Small-arms fighting",
    "194": "Artillery and tank fighting",
    "195": "Aerial attack",
    "1951": "Precision-guided aerial attack",
    "1952": "Drone attack",
    "196": "Ceasefire violation",
    "20": "Mass violence",
    "200": "Mass violence",
    "201": "Mass expulsion",
    "202": "Mass killing",
    "203": "Ethnic cleansing",
    "204": "Use of weapons of mass destruction",
}


def label_for(code: str) -> str:
    for length in (4, 3, 2):
        if code[:length] in LABELS:
            return LABELS[code[:length]]
    return "Incident"


def _int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def _float(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def parse_rows(rows) -> list[RawIn]:
    records = []
    for r in rows:
        if len(r) < 61:
            continue
        kind = ROOTS.get(r[C_ROOT])
        if kind is None or r[C_GEO_TYPE] not in CITY_LEVEL:
            continue
        lat, lon = _float(r[C_LAT]), _float(r[C_LON])
        if lat is None or lon is None:
            continue
        try:
            added = datetime.strptime(r[C_ADDED], STAMP).replace(tzinfo=UTC)
        except ValueError:
            continue
        records.append(
            RawIn(
                source="gdelt",
                external_id=r[C_ID],
                kind="gdelt",
                observed_at=added,
                lat=lat,
                lon=lon,
                payload={
                    "type": kind,
                    "root": r[C_ROOT],
                    "code": r[C_CODE],
                    "label": label_for(r[C_CODE]),
                    "actor1": r[C_ACTOR1],
                    "actor2": r[C_ACTOR2],
                    "root_event": r[C_ROOT_FLAG] == "1",
                    "goldstein": _float(r[C_GOLDSTEIN]),
                    "mentions": _int(r[C_MENTIONS]),
                    "sources": _int(r[C_SOURCES]),
                    "articles": _int(r[C_ARTICLES]),
                    "tone": _float(r[C_TONE]),
                    "place": r[C_GEO_NAME],
                    "fips": r[C_GEO_CC],
                    "url": r[C_URL],
                },
            )
        )
    return records


def parse_zip(data: bytes) -> list[RawIn]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = z.namelist()[0]
        with z.open(name) as f:
            text = io.TextIOWrapper(f, "utf-8", errors="replace")
            return parse_rows(csv.reader(text, delimiter="\t"))


def stamps_to_fetch(latest: str, cursor: str | None, limit: int = 8):
    """15-minute slots after the cursor up to latest, newest last.

    GDELT sometimes lists a file a while before it can be downloaded, so
    the caller may find the newest slots missing and try them again later.
    """
    end = datetime.strptime(latest, STAMP)
    start = (
        datetime.strptime(cursor, STAMP) + timedelta(minutes=15)
        if cursor
        else end - timedelta(minutes=15 * (limit - 1))
    )
    start = max(start, end - timedelta(minutes=15 * (limit - 1)))
    slots = []
    t = start
    while t <= end:
        slots.append(t.strftime(STAMP))
        t += timedelta(minutes=15)
    return slots


class GdeltCollector(Collector):
    name = "gdelt"
    label = "GDELT 2.0 events"
    interval_s = 300
    licence = "Free with attribution"
    terms_url = "https://www.gdeltproject.org/about.html#termsofuse"

    async def collect(self, client: httpx.AsyncClient, cursor):
        index = await client.get(INDEX)
        if index.status_code != 200:
            raise SourceError(
                "GDELT index returned {0}".format(index.status_code)
            )
        first = index.text.split("\n", 1)[0].split()
        if len(first) < 3 or ".export." not in first[2]:
            raise SourceError("GDELT index has an unexpected format")
        latest = first[2].rsplit("/", 1)[-1].split(".", 1)[0]
        records: list[RawIn] = []
        new_cursor = cursor
        for stamp in stamps_to_fetch(latest, cursor):
            response = await client.get(FILE.format(stamp))
            if response.status_code == 404:
                # Not published yet; stop here and retry next run.
                break
            if response.status_code != 200:
                raise SourceError(
                    "GDELT file {0} returned {1}".format(
                        stamp, response.status_code
                    )
                )
            records.extend(parse_zip(response.content))
            new_cursor = stamp
        return CollectResult(records=records, cursor=new_cursor)
