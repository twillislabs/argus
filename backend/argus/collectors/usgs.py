"""USGS earthquakes: magnitude 2.5+ in the past day.

Feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
Licence: US government work, public domain. The feed updates every minute.
"""

from datetime import UTC, datetime

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

FEED = (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
)


def parse(doc: dict) -> list[RawIn]:
    records = []
    for feature in doc.get("features", []):
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2 or props.get("time") is None:
            continue
        records.append(
            RawIn(
                source="usgs",
                external_id=str(feature.get("id")),
                kind="quake",
                observed_at=datetime.fromtimestamp(props["time"] / 1000, UTC),
                lat=float(coords[1]),
                lon=float(coords[0]),
                payload={
                    "mag": props.get("mag"),
                    "mag_type": props.get("magType"),
                    "depth_km": coords[2] if len(coords) > 2 else None,
                    "place": props.get("place") or "",
                    "title": props.get("title") or "",
                    "url": props.get("url"),
                    "alert": props.get("alert"),
                    "tsunami": props.get("tsunami"),
                    "status": props.get("status"),
                    "sig": props.get("sig"),
                    "updated": props.get("updated"),
                },
            )
        )
    return records


class UsgsCollector(Collector):
    name = "usgs"
    label = "USGS earthquakes"
    interval_s = 60
    licence = "Public domain (US government work)"
    terms_url = "https://www.usgs.gov/information-policies-and-instructions"

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(FEED)
        if response.status_code != 200:
            raise SourceError(
                "USGS feed returned {0}".format(response.status_code)
            )
        return CollectResult(records=parse(response.json()))
