"""NASA FIRMS thermal anomalies (VIIRS S-NPP, last 24 h), clustered.

API: https://firms.modaps.eosdis.nasa.gov/api/area/
Needs a free MAP_KEY (ARGUS_FIRMS_MAP_KEY). Without one this collector is
skipped. NASA data is free to use; cite "NASA FIRMS".

The world file has tens of thousands of detections a day, so detections
are binned on a 0.25 degree grid and only cells with enough confident
detections become records.
"""

import csv
import io
from collections import defaultdict
from datetime import UTC, datetime

import httpx

from argus.collectors.base import Collector, CollectResult, RawIn, SourceError

URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{0}/"
    "VIIRS_SNPP_NRT/world/1"
)
CELL_DEG = 0.25
MIN_DETECTIONS = 8


def cluster(text: str) -> list[RawIn]:
    cells: dict[tuple[int, int, str], list[dict]] = defaultdict(list)
    for row in csv.DictReader(io.StringIO(text)):
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            frp = float(row.get("frp") or 0)
        except (KeyError, ValueError):
            continue
        confidence = (row.get("confidence") or "").lower()
        if confidence not in ("h", "high", "n", "nominal") and frp < 10:
            continue
        key = (
            int(lat // CELL_DEG),
            int(lon // CELL_DEG),
            row.get("acq_date", ""),
        )
        cells[key].append(
            {
                "lat": lat,
                "lon": lon,
                "frp": frp,
                "time": row.get("acq_time", "0000"),
            }
        )
    records = []
    for (ci, cj, day), hits in cells.items():
        if len(hits) < MIN_DETECTIONS:
            continue
        lat = sum(h["lat"] for h in hits) / len(hits)
        lon = sum(h["lon"] for h in hits) / len(hits)
        latest = max(h["time"] for h in hits).zfill(4)
        try:
            observed = datetime.strptime(day + latest, "%Y-%m-%d%H%M").replace(
                tzinfo=UTC
            )
        except ValueError:
            continue
        records.append(
            RawIn(
                source="firms",
                external_id="{0}:{1}:{2}".format(ci, cj, day),
                kind="fire_cluster",
                observed_at=observed,
                lat=round(lat, 4),
                lon=round(lon, 4),
                payload={
                    "detections": len(hits),
                    "max_frp": round(max(h["frp"] for h in hits), 1),
                    "total_frp": round(sum(h["frp"] for h in hits), 1),
                    "date": day,
                },
            )
        )
    return records


class FirmsCollector(Collector):
    name = "firms"
    label = "NASA FIRMS thermal anomalies"
    interval_s = 3 * 3600
    licence = "NASA open data; cite NASA FIRMS"
    terms_url = "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies"

    def enabled(self) -> bool:
        return bool(self.settings.firms_map_key)

    async def collect(self, client: httpx.AsyncClient, cursor):
        response = await client.get(
            URL.format(self.settings.firms_map_key), timeout=120
        )
        if response.status_code != 200 or response.text.startswith("Invalid"):
            raise SourceError(
                "FIRMS returned {0}: {1}".format(
                    response.status_code, response.text[:120]
                )
            )
        return CollectResult(records=cluster(response.text))
