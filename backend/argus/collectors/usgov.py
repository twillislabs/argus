"""US government disaster feeds (public domain, no key).

- OpenFEMA disaster declarations: one per declaration (DR, EM or FM),
  its counties listed, placed at the state's population centre. Kept
  for 30 days after it's declared.
  https://www.fema.gov/about/openfema/api
- NIFC wildfire incidents (WFIGS, the National Interagency Fire
  Center's current incident locations): wildfires of 100 acres or
  more that aren't yet fully contained, with size and containment.
  https://data-nifc.opendata.arcgis.com/

Both become RawIn of kind "hazard", so fusion.fuse_hazard makes them
"Disasters" events. Each record carries the day it was last seen, so
it's re-stamped (and stays on the 24-hour map) while still current.
"""

from datetime import UTC, datetime, timedelta

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

FEMA = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries"
WFIGS = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
    "WFIGS_Incident_Locations_Current/FeatureServer/0/query"
)
FEMA_DAYS = 30
FIRE_MIN_ACRES = 100

DECLARATION_TYPES = {
    "DR": "Major disaster declaration",
    "EM": "Emergency declaration",
    "FM": "Fire management declaration",
}
FEMA_HAZARD = {
    "Hurricane": "cyclone",
    "Typhoon": "cyclone",
    "Tropical Storm": "cyclone",
    "Flood": "flood",
    "Coastal Storm": "storm",
    "Severe Storm": "storm",
    "Severe Storm(s)": "storm",
    "Tornado": "storm",
    "Winter Storm": "snow",
    "Snowstorm": "snow",
    "Severe Ice Storm": "snow",
    "Fire": "wildfire",
    "Earthquake": "quake",
    "Volcanic Eruption": "volcano",
    "Mud/Landslide": "landslide",
    "Drought": "drought",
    "Tsunami": "tsunami",
}


def _iso(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def parse_fema(rows: list[dict], now: datetime) -> list[RawIn]:
    """One record per declaration, from FEMA's one row per county."""
    from argus import newsevents, places

    _, states = newsevents.us_places()
    by_decl: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("femaDeclarationString"):
            by_decl.setdefault(r["femaDeclarationString"], []).append(r)
    out = []
    for decl, items in by_decl.items():
        first = items[0]
        state = places.US_STATES.get(first.get("state") or "", "")
        centre = states.get(places.fold(state))
        if state == "Washington":
            centre = _washington()
        if not centre:
            continue
        _, lat, lon = centre
        counties = sorted(
            {
                (r.get("designatedArea") or "").replace(" (County)", "")
                for r in items
                if r.get("designatedArea")
            }
        )
        kind = DECLARATION_TYPES.get(first.get("declarationType"), "")
        incident = first.get("incidentType") or "Disaster"
        title = (first.get("declarationTitle") or incident).title()
        severity = 3 if first.get("declarationType") == "DR" else 2
        out.append(
            RawIn(
                source="fema",
                external_id=decl,
                kind="hazard",
                observed_at=now,
                lat=round(lat, 4),
                lon=round(lon, 4),
                payload={
                    "provider": "FEMA",
                    "hazard": FEMA_HAZARD.get(incident, "manmade"),
                    "title": "{0}: {1}, {2}".format(kind, title, state)[:300],
                    "summary": (
                        "{0} {1} for {2} ({3}), declared {4}. {5}: {6}."
                    ).format(
                        decl,
                        kind.lower(),
                        title,
                        incident,
                        (first.get("declarationDate") or "")[:10],
                        "Areas" if len(counties) > 1 else "Area",
                        "{0}{1}".format(
                            ", ".join(counties[:25]),
                            " and more" if len(counties) > 25 else "",
                        ),
                    ),
                    "severity": severity,
                    "country": "United States",
                    "place": "{0}, United States".format(state),
                    "from": first.get("incidentBeginDate"),
                    "to": first.get("incidentEndDate"),
                    "url": "https://www.fema.gov/disaster/{0}".format(
                        first.get("disasterNumber")
                    ),
                    "seen": now.date().isoformat(),
                },
            )
        )
    return out


def _washington() -> tuple[str, float, float]:
    # Washington is left out of headline matching (the government), so
    # place the state from its own cities here.
    from argus import places

    total = lat = lon = 0.0
    for p in places.load():
        if p.cc == "US" and p.region == "Washington":
            lat += p.lat * p.population
            lon += p.lon * p.population
            total += p.population
    return ("Washington", lat / total, lon / total)


def parse_wfigs(doc: dict, now: datetime) -> list[RawIn]:
    out = []
    for f in doc.get("features") or []:
        p = f.get("properties") or {}
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2 or not p.get("UniqueFireIdentifier"):
            continue
        acres = float(p.get("IncidentSize") or 0)
        contained = p.get("PercentContained")
        if acres < FIRE_MIN_ACRES or (contained or 0) >= 100:
            continue
        severity = 4 if acres >= 100_000 else 3 if acres >= 10_000 else 2
        state = (p.get("POOState") or "").replace("US-", "")
        county = p.get("POOCounty")
        where = ", ".join(
            x for x in (county and "{0} County".format(county), state) if x
        )
        found = p.get("FireDiscoveryDateTime")
        out.append(
            RawIn(
                source="nifc",
                external_id=p["UniqueFireIdentifier"],
                kind="hazard",
                observed_at=now,
                lat=round(float(coords[1]), 4),
                lon=round(float(coords[0]), 4),
                payload={
                    "provider": "NIFC",
                    "hazard": "wildfire",
                    "title": "{0} Fire ({1})".format(
                        (p.get("IncidentName") or "Unnamed").strip().title(),
                        where,
                    )[:300],
                    "summary": (
                        "{0:,.0f} acres, {1} contained. {2} personnel. "
                        "Cause: {3}."
                    ).format(
                        acres,
                        "{0:.0f}%".format(contained)
                        if contained is not None
                        else "not yet reported",
                        int(p.get("TotalIncidentPersonnel") or 0),
                        (p.get("FireCause") or "undetermined").lower(),
                    ),
                    "severity": severity,
                    "country": "United States",
                    "acres": acres,
                    "contained": contained,
                    "from": datetime.fromtimestamp(
                        found / 1000, UTC
                    ).isoformat()
                    if found
                    else None,
                    "url": "https://inciweb.wildfire.gov/",
                    "seen": now.strftime("%Y-%m-%dT%H"),
                },
            )
        )
    return out


class FemaCollector(Collector):
    name = "fema"
    label = "FEMA disaster declarations"
    interval_s = 6 * 3600
    licence = "Public domain (FEMA OpenFEMA)"
    terms_url = "https://www.fema.gov/about/openfema/terms-conditions"

    async def collect(self, client: httpx.AsyncClient, cursor):
        now = datetime.now(UTC)
        since = (now - timedelta(days=FEMA_DAYS)).strftime("%Y-%m-%d")
        response = await client.get(
            FEMA,
            params={
                "$filter": "declarationDate ge '{0}'".format(since),
                "$orderby": "declarationDate desc",
                "$top": "1000",
            },
        )
        if response.status_code != 200:
            raise SourceError(
                "OpenFEMA returned {0}".format(response.status_code)
            )
        rows = response.json().get("DisasterDeclarationsSummaries") or []
        return CollectResult(records=parse_fema(rows, now))


class NifcCollector(Collector):
    name = "nifc"
    label = "NIFC wildfire incidents"
    interval_s = 1800
    licence = "Public domain (National Interagency Fire Center)"
    terms_url = "https://data-nifc.opendata.arcgis.com/"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(
            WFIGS,
            params={
                "where": (
                    "IncidentTypeCategory='WF' AND IncidentSize>={0} AND "
                    "(PercentContained<100 OR PercentContained IS NULL)"
                ).format(FIRE_MIN_ACRES),
                "outFields": (
                    "IncidentName,IncidentSize,PercentContained,"
                    "FireDiscoveryDateTime,POOState,POOCounty,"
                    "UniqueFireIdentifier,FireCause,TotalIncidentPersonnel"
                ),
                "f": "geojson",
                "resultRecordCount": "2000",
            },
        )
        if response.status_code != 200:
            raise SourceError("NIFC returned {0}".format(response.status_code))
        return CollectResult(
            records=parse_wfigs(response.json(), datetime.now(UTC))
        )
