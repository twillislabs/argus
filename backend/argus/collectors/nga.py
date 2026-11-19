"""NGA maritime safety broadcast warnings (NAVAREA IV and XII, HYDROLANT,
HYDROPAC): live firing, missile tests, hazards, piracy, cable work.

Source: NGA Maritime Safety Information, public domain (US government).
https://msi.nga.mil/  (API: /api/publications/broadcast-warn)

Each active warning becomes a "maritime" event placed at the first
position in its text; every position found is kept for drawing areas.
"""

import re
from datetime import UTC, datetime

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

API = "https://msi.nga.mil/api/publications/broadcast-warn"

# 36-45.00N 015-10.00E, 36-45N 015-10E, 36-45.5N. 015-10.5E.
POSITION = re.compile(
    r"(\d{1,2})-(\d{1,2}(?:\.\d+)?)\s*([NS])\.?\s*"
    r"(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([EW])"
)

SEVERE = (
    "PIRACY",
    "PIRATE",
    "ATTACK",
    "HIJACK",
    "MINE ",
    "MINES",
    "UNEXPLODED",
)
MILITARY = (
    "MISSILE",
    "ROCKET",
    "FIRING",
    "GUNNERY",
    "EXERCISE",
    "HAZARDOUS OPERATIONS",
    "SPACE DEBRIS",
    "LAUNCH",
)

AREAS = {
    "4": "NAVAREA IV",
    "12": "NAVAREA XII",
    "A": "HYDROLANT",
    "P": "HYDROPAC",
    "C": "Coastal",
}


def positions(text: str) -> list[tuple[float, float]]:
    out = []
    for m in POSITION.finditer(text.upper()):
        lat = int(m.group(1)) + float(m.group(2)) / 60
        lon = int(m.group(4)) + float(m.group(5)) / 60
        if m.group(3) == "S":
            lat = -lat
        if m.group(6) == "W":
            lon = -lon
        if abs(lat) <= 90 and abs(lon) <= 180:
            out.append((round(lat, 4), round(lon, 4)))
    return out


def severity(text: str) -> int:
    up = text.upper()
    if any(word in up for word in SEVERE):
        return 3
    if any(word in up for word in MILITARY):
        return 2
    return 1


def topic(text: str) -> str:
    """A short title from the warning's first sentence."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    for ln in lines:
        # Skip the header line ("NAVAREA IV 1234/26(11)." or a DTG).
        if re.match(r"^(NAVAREA|HYDRO|\d{6}Z)", ln.upper()):
            continue
        return ln.rstrip(".")[:120].capitalize()
    return "Navigational warning"


def parse(doc, now: datetime) -> list[RawIn]:
    items = doc.get("broadcast-warn", []) if isinstance(doc, dict) else doc
    out = []
    for w in items or []:
        if str(w.get("status", "A")).upper() != "A":
            continue
        text = str(w.get("text") or "")
        points = positions(text)
        if not points:
            continue
        area = AREAS.get(str(w.get("navArea", "")), str(w.get("navArea", "")))
        ident = "{0} {1}/{2}".format(
            area, w.get("msgNumber", "?"), str(w.get("msgYear", ""))[-2:]
        )
        out.append(
            RawIn(
                source="nga",
                external_id=ident,
                kind="navwarn",
                observed_at=now,
                lat=points[0][0],
                lon=points[0][1],
                payload={
                    "id": ident,
                    "area": area,
                    "subregion": w.get("subregion"),
                    "issued": w.get("issueDate"),
                    "authority": w.get("authority"),
                    "title": topic(text),
                    "text": text[:4000],
                    "points": points[:200],
                    "severity": severity(text),
                    # Changes once a day, so a warning that stays active
                    # refreshes its event daily without churning hourly.
                    "seen": now.date().isoformat(),
                },
            )
        )
    return out


class NgaCollector(Collector):
    name = "nga"
    label = "NGA navigational warnings"
    interval_s = 3600
    licence = "Public domain (US government)"
    terms_url = "https://msi.nga.mil/"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(
            API, params={"output": "json", "status": "A"}
        )
        if response.status_code != 200:
            raise SourceError(
                "NGA MSI returned {0}".format(response.status_code)
            )
        try:
            doc = response.json()
        except ValueError as exc:
            raise SourceError(
                "NGA MSI sent something other than JSON"
            ) from exc
        return CollectResult(records=parse(doc, datetime.now(UTC)))
