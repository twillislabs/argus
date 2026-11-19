"""Satellites: the CelesTrak catalogue, orbit classes and tags.

CelesTrak publishes GP elements (OMM JSON) by group, refreshed about
every two hours, and asks clients not to fetch a group more often. The
worker fetches "active" (every payload in orbit, about 17,000) every six
hours, plus a few small groups used only as tags. Browsers propagate the
elements themselves (SGP4 in a Web Worker), so the API just serves them.
"""

import logging
import math
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from argus.db import utcnow
from argus.models import Satellite

log = logging.getLogger("argus.space")

CELESTRAK = "https://celestrak.org/NORAD/elements/gp.php"
MAIN_GROUP = "active"
# Small groups fetched only to tag satellites in the main group.
TAG_GROUPS = {
    "stations": "station",
    "weather": "weather",
    "gps-ops": "gnss",
    "glo-ops": "gnss",
    "galileo": "gnss",
    "beidou": "gnss",
    "military": "military",
    "science": "science",
    "amateur": "amateur",
    "last-30-days": "new",
}
# Name prefixes that mark constellations (too big to fetch as tags).
NAME_TAGS = {"STARLINK": "starlink", "ONEWEB": "oneweb", "KUIPER": "kuiper"}
REFRESH = timedelta(hours=6)

# Fields the browser needs to build an SGP4 record (and nothing else).
OMM_FIELDS = (
    "OBJECT_NAME",
    "OBJECT_ID",
    "EPOCH",
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "EPHEMERIS_TYPE",
    "CLASSIFICATION_TYPE",
    "NORAD_CAT_ID",
    "ELEMENT_SET_NO",
    "REV_AT_EPOCH",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
)

EARTH_RADIUS_KM = 6378.137
MU = 398600.4418  # km^3/s^2


def orbit_class(mean_motion: float, eccentricity: float) -> str:
    """leo, meo, geo or heo from revolutions per day and eccentricity."""
    if eccentricity >= 0.25:
        return "heo"
    if mean_motion >= 11.25:  # period under 128 minutes
        return "leo"
    if 0.9 <= mean_motion <= 1.1:
        return "geo"
    return "meo"


def orbit_numbers(omm: dict) -> dict:
    """Period, apogee and perigee (km above the surface) from elements."""
    n = float(omm["MEAN_MOTION"])  # rev/day
    e = float(omm["ECCENTRICITY"])
    period_s = 86400.0 / n
    a = (MU * (period_s / (2 * math.pi)) ** 2) ** (1 / 3)
    return {
        "period_min": round(period_s / 60, 1),
        "apogee_km": round(a * (1 + e) - EARTH_RADIUS_KM),
        "perigee_km": round(a * (1 - e) - EARTH_RADIUS_KM),
        "inclination": round(float(omm["INCLINATION"]), 2),
    }


def _epoch(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def name_tags(name: str) -> list[str]:
    up = name.upper()
    return [tag for prefix, tag in NAME_TAGS.items() if up.startswith(prefix)]


async def fetch_group(client: httpx.AsyncClient, group: str) -> list[dict]:
    response = await client.get(
        CELESTRAK, params={"GROUP": group, "FORMAT": "json"}
    )
    if response.status_code != 200:
        raise httpx.HTTPStatusError(
            "CelesTrak {0} returned {1}".format(group, response.status_code),
            request=response.request,
            response=response,
        )
    data = response.json()
    return data if isinstance(data, list) else []


async def refresh_catalog(
    db: AsyncSession, client: httpx.AsyncClient
) -> tuple[int, list[str]]:
    """Replace the catalogue with CelesTrak's. Returns (count, failures).

    Tag groups that fail are skipped; the main group failing raises.
    """
    main = await fetch_group(client, MAIN_GROUP)
    if len(main) < 1000:
        raise ValueError(
            "CelesTrak returned only {0} objects".format(len(main))
        )
    tags: dict[int, set[str]] = {}
    failures = []
    for group, tag in TAG_GROUPS.items():
        try:
            for record in await fetch_group(client, group):
                tags.setdefault(int(record["NORAD_CAT_ID"]), set()).add(tag)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            log.warning("CelesTrak tag group {0}: {1}".format(group, exc))
            failures.append(group)
    now = utcnow()
    await db.execute(delete(Satellite))
    for record in main:
        try:
            norad = int(record["NORAD_CAT_ID"])
            omm = {k: record[k] for k in OMM_FIELDS if k in record}
            name = str(record.get("OBJECT_NAME") or norad)[:80]
            db.add(
                Satellite(
                    norad_id=norad,
                    name=name,
                    object_id=str(record.get("OBJECT_ID") or "")[:16],
                    orbit_class=orbit_class(
                        float(record["MEAN_MOTION"]),
                        float(record["ECCENTRICITY"]),
                    ),
                    tags=sorted(tags.get(norad, set()) | set(name_tags(name))),
                    epoch=_epoch(record["EPOCH"]),
                    omm=omm,
                    updated_at=now,
                )
            )
        except (KeyError, ValueError, TypeError):
            continue
    await db.flush()
    return len(main), failures


async def catalog(db: AsyncSession) -> list[Satellite]:
    rows = await db.execute(select(Satellite).order_by(Satellite.norad_id))
    return list(rows.scalars())


def compact(s: Satellite) -> list:
    """One satellite for /api/satellites, as a positional array:
    [norad, name, cospar, class, tags, epoch, mean motion, eccentricity,
    inclination, raan, arg of perigee, mean anomaly, bstar, ndot, nddot].
    """
    o = s.omm
    return [
        s.norad_id,
        s.name,
        s.object_id,
        s.orbit_class,
        s.tags,
        o.get("EPOCH"),
        o.get("MEAN_MOTION"),
        o.get("ECCENTRICITY"),
        o.get("INCLINATION"),
        o.get("RA_OF_ASC_NODE"),
        o.get("ARG_OF_PERICENTER"),
        o.get("MEAN_ANOMALY"),
        o.get("BSTAR"),
        o.get("MEAN_MOTION_DOT"),
        o.get("MEAN_MOTION_DDOT"),
    ]
