"""Airspace: FAA temporary flight restrictions, SIGMETs, EASA conflict
zone bulletins.

- FAA TFRs (tfr.faa.gov, public domain): the current list, joined to the
  TFR shapes from the FAA's map service (which also holds expired ones).
- SIGMETs from aviationweather.gov (NOAA, public domain): international
  SIGMETs and US SIGMETs as GeoJSON, with hazard, validity and levels.
- EASA Conflict Zone Information Bulletins (easa.europa.eu): the table of
  active bulletins and the airspace each covers.

Each becomes a raw record of kind "airspace" (not an event): the API
serves those still valid, and the map draws their areas.
"""

import html
import re
from datetime import UTC, datetime

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

TFR_LIST = "https://tfr.faa.gov/tfrapi/exportTfrList"
TFR_SHAPES = (
    "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0"
    "&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=2000"
    "&outputFormat=application/json&srsname=EPSG:4326"
)
ISIGMET = "https://aviationweather.gov/api/data/isigmet?format=geojson"
AIRSIGMET = "https://aviationweather.gov/api/data/airsigmet?format=geojson"
CZIB = "https://www.easa.europa.eu/en/domains/air-operations/czibs"

HAZARDS = {
    "TURB": "Turbulence",
    "ICE": "Icing",
    "IFR": "Low visibility",
    "MTN OBSCN": "Mountains obscured",
    "CONVECTIVE": "Thunderstorms",
    "TS": "Thunderstorms",
    "VA": "Volcanic ash",
    "TC": "Tropical cyclone",
    "MTW": "Mountain waves",
    "DS": "Duststorm",
    "SS": "Sandstorm",
    "RDOACT": "Radioactive cloud",
}


def _ring(geometry: dict) -> list[list[float]] | None:
    """The outer ring of a Polygon (or the largest of a MultiPolygon)."""
    if not geometry:
        return None
    if geometry.get("type") == "Polygon":
        rings = [geometry["coordinates"][0]]
    elif geometry.get("type") == "MultiPolygon":
        rings = [p[0] for p in geometry["coordinates"]]
    else:
        return None
    ring = max(rings, key=len)
    out = [[round(float(x), 4), round(float(y), 4)] for x, y, *_ in ring]
    return out if len(out) >= 4 else None


def _centre(ring: list[list[float]]) -> tuple[float, float]:
    xs = [p[0] for p in ring[:-1]]
    ys = [p[1] for p in ring[:-1]]
    return sum(ys) / len(ys), sum(xs) / len(xs)


def parse_tfrs(listing: list, shapes: dict, now: datetime) -> list[RawIn]:
    current = {
        str(item.get("notam_id", "")).strip(): item
        for item in listing or []
        if item.get("notam_id")
    }
    out = []
    # A TFR can have several shapes; number them per NOTAM so ids stay
    # the same from run to run.
    shapes_per_notam: dict[str, int] = {}
    for f in shapes.get("features", []):
        p = f.get("properties") or {}
        notam = str(p.get("NOTAM_KEY", "")).split("-")[0]
        if notam not in current:
            continue
        ring = _ring(f.get("geometry"))
        if ring is None:
            continue
        index = shapes_per_notam.get(notam, 0)
        shapes_per_notam[notam] = index + 1
        key = "{0}#{1}".format(notam, index)
        info = current[notam]
        lat, lon = _centre(ring)
        out.append(
            RawIn(
                source="faa_tfr",
                external_id=key,
                kind="airspace",
                observed_at=now,
                lat=lat,
                lon=lon,
                payload={
                    "kind": "tfr",
                    "id": "TFR {0}".format(notam),
                    "title": (p.get("TITLE") or info.get("description") or "")
                    .strip()
                    .rstrip(","),
                    "hazard": (p.get("LEGAL") or info.get("type") or "")
                    .strip()
                    .title(),
                    "facility": info.get("facility"),
                    "polygon": ring,
                    "url": "https://tfr.faa.gov/tfr3/?page=detail_{0}".format(
                        notam.replace("/", "_")
                    ),
                    # Hourly, so a TFR dropped from the FAA list stops
                    # being refreshed and leaves the map within two hours.
                    "seen": now.strftime("%Y-%m-%dT%H"),
                },
            )
        )
    return out


def parse_sigmets(
    doc: dict, now: datetime, international: bool
) -> list[RawIn]:
    out = []
    for f in doc.get("features", []):
        p = f.get("properties") or {}
        ring = _ring(f.get("geometry"))
        if ring is None:
            continue
        valid_to = p.get("validTimeTo")
        if valid_to:
            try:
                if (
                    datetime.fromisoformat(valid_to.replace("Z", "+00:00"))
                    < now
                ):
                    continue
            except ValueError:
                pass
        hazard = str(p.get("hazard") or "")
        if international:
            ident = "{0} SIGMET {1}".format(
                p.get("firId") or p.get("icaoId"), p.get("seriesId")
            )
            base, top = p.get("base"), p.get("top")
            area = p.get("firName") or p.get("firId")
            raw = p.get("rawSigmet") or ""
            qualifier = p.get("qualifier") or ""
        else:
            ident = "{0} {1}".format(
                p.get("airSigmetType") or "SIGMET", p.get("seriesId")
            )
            base = p.get("altitudeLow2") or p.get("altitudeLow1")
            top = p.get("altitudeHi2") or p.get("altitudeHi1")
            area = "United States"
            raw = p.get("rawAirSigmet") or ""
            qualifier = ""
        lat, lon = _centre(ring)
        out.append(
            RawIn(
                source="sigmet",
                external_id="{0}|{1}".format(ident, p.get("validTimeFrom")),
                kind="airspace",
                observed_at=now,
                lat=lat,
                lon=lon,
                payload={
                    "kind": "sigmet",
                    "id": ident,
                    "title": "{0}{1}".format(
                        HAZARDS.get(hazard, hazard.title() or "SIGMET"),
                        " · {0}".format(qualifier.title())
                        if qualifier
                        else "",
                    ),
                    "hazard": HAZARDS.get(hazard, hazard),
                    "area": area,
                    "valid_from": p.get("validTimeFrom"),
                    "valid_to": valid_to,
                    "base_ft": base,
                    "top_ft": top,
                    "polygon": ring,
                    "raw": raw[:2000],
                    "url": "https://aviationweather.gov/gfa/#sigmet",
                },
            )
        )
    return out


def _date(text: str) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", text.strip())
    return (
        "{0}-{1}-{2}".format(m.group(3), m.group(2), m.group(1)) if m else None
    )


def parse_czibs(page: str, now: datetime) -> list[RawIn]:
    """The table of active bulletins on EASA's CZIB page."""
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [
            " ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split())
            for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        ]
        if len(cells) < 4 or "Active" not in cells[3]:
            continue
        m = re.search(r"(CZIB-\d{4}-\d{2}[- ]?R?\d*)", cells[3])
        if not m:
            continue
        ident = m.group(1).replace(" ", "")
        subject = cells[3][: m.start()].strip()
        region = re.sub(r"^Airspace of (the )?", "", subject).strip()
        countries = [
            c.strip()
            for c in re.split(r",| and ", region)
            if c.strip()
            and not c.strip().lower().startswith(("gulf", "persian"))
        ]
        link = re.search(
            r'href="(/en/domains/air-operations/czibs/[^"]+)"', row
        )
        out.append(
            RawIn(
                source="czib",
                external_id=ident,
                kind="airspace",
                observed_at=now,
                lat=None,
                lon=None,
                payload={
                    "kind": "czib",
                    "id": ident,
                    "title": subject,
                    "region": region,
                    "countries": countries,
                    "issued": _date(cells[0]),
                    "revised": _date(cells[1]),
                    "valid_to": _date(cells[2]),
                    "url": "https://www.easa.europa.eu{0}".format(
                        link.group(1)
                    )
                    if link
                    else CZIB,
                    "seen": now.date().isoformat(),
                },
            )
        )
    return out


class TfrCollector(Collector):
    name = "faa_tfr"
    label = "FAA temporary flight restrictions"
    interval_s = 900
    licence = "Public domain (FAA)"
    terms_url = "https://tfr.faa.gov/"

    async def collect(self, client: httpx.AsyncClient, cursor):
        listing = await client.get(TFR_LIST)
        shapes = await client.get(TFR_SHAPES)
        if listing.status_code != 200 or shapes.status_code != 200:
            raise SourceError(
                "FAA TFR returned {0}/{1}".format(
                    listing.status_code, shapes.status_code
                )
            )
        return CollectResult(
            records=parse_tfrs(
                listing.json(), shapes.json(), datetime.now(UTC)
            )
        )


class SigmetCollector(Collector):
    name = "sigmet"
    label = "SIGMETs (aviationweather.gov)"
    interval_s = 600
    licence = "Public domain (NOAA)"
    terms_url = "https://aviationweather.gov/data/api/"

    async def collect(self, client: httpx.AsyncClient, cursor):
        now = datetime.now(UTC)
        records, failures = [], []
        for url, international in ((ISIGMET, True), (AIRSIGMET, False)):
            response = await client.get(url)
            if response.status_code != 200:
                failures.append("isigmet" if international else "airsigmet")
                continue
            records += parse_sigmets(response.json(), now, international)
        if len(failures) == 2:
            raise SourceError("aviationweather.gov returned errors")
        return CollectResult(records=records, failures=failures)


class CzibCollector(Collector):
    name = "czib"
    label = "EASA conflict zone bulletins"
    interval_s = 6 * 3600
    licence = "EASA; free to reuse with credit"
    terms_url = "https://www.easa.europa.eu/en/legal-notice"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(CZIB)
        if response.status_code != 200:
            raise SourceError("EASA returned {0}".format(response.status_code))
        records = parse_czibs(response.text, datetime.now(UTC))
        if not records:
            raise SourceError(
                "No bulletins found; the EASA page may have changed"
            )
        return CollectResult(records=records)
