"""Public transport: live vehicle positions from operators' open
GTFS-Realtime feeds (no keys), for the map's Public transport layer.

Each feed covers an area (FEEDS, its bbox). A request for the view
fetches only the feeds whose area it overlaps, each at most every
MIN_AGE_S seconds however many people are looking, and keeps a feed's
last vehicles when it fails. Vehicles are positions only: route, label,
bearing and when they were reported. Every feed is credited by name.
"""

import asyncio
import logging
import time

import httpx
from google.protobuf.message import DecodeError
from google.transit import gtfs_realtime_pb2

log = logging.getLogger("argus.transit")

MIN_AGE_S = 20
# A vehicle not heard from for this long is left off the map.
STALE_S = 600
MAX_BYTES = 8_000_000
MAX_VEHICLES = 4000

# key, operator, area (west, south, east, north), URL, licence.
FEEDS = [
    {
        "key": "mbta",
        "name": "MBTA (Boston)",
        "bbox": (-71.9, 41.6, -70.5, 42.9),
        "url": "https://cdn.mbta.com/realtime/VehiclePositions.pb",
        "licence": "MassDOT Developers' License Agreement",
    },
    {
        "key": "rtd",
        "name": "RTD (Denver)",
        "bbox": (-105.4, 39.4, -104.6, 40.2),
        "url": "https://www.rtd-denver.com/api/download"
        "?feedType=gtfs-rt&filename=VehiclePosition.pb",
        "licence": "RTD open data",
    },
    {
        "key": "ttc",
        "name": "TTC (Toronto)",
        "bbox": (-79.7, 43.55, -79.1, 43.9),
        "url": "https://bustime.ttc.ca/gtfsrt/vehicles",
        "licence": "Open Government Licence – Toronto",
    },
    {
        "key": "calgary",
        "name": "Calgary Transit",
        "bbox": (-114.4, 50.8, -113.8, 51.25),
        "url": "https://data.calgary.ca/download/am7c-qe3u/"
        "application%2Foctet-stream",
        "licence": "Open Government Licence – City of Calgary",
    },
    {
        "key": "edmonton",
        "name": "Edmonton Transit Service",
        "bbox": (-113.8, 53.35, -113.2, 53.75),
        "url": "https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/"
        "Vehicle/VehiclePositions.pb",
        "licence": "Open Government Licence – Edmonton",
    },
    {
        "key": "victoria",
        "name": "BC Transit (Victoria)",
        "bbox": (-123.8, 48.3, -123.2, 48.75),
        "url": "https://bct.tmix.se/gtfs-realtime/vehicleupdates.pb"
        "?operatorIds=48",
        "licence": "BC Transit open data",
    },
    {
        "key": "hsl",
        "name": "HSL (Helsinki)",
        "bbox": (24.3, 59.9, 25.6, 60.6),
        "url": "https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl",
        "licence": "Helsinki Region Transport, CC BY 4.0",
    },
    {
        "key": "ovapi",
        "name": "OVapi (Netherlands)",
        "bbox": (3.2, 50.7, 7.3, 53.6),
        "url": "https://gtfs.ovapi.nl/nl/vehiclePositions.pb",
        "licence": "OpenOV / OVapi",
    },
    {
        "key": "seq",
        "name": "Translink (South East Queensland)",
        "bbox": (152.3, -28.4, 153.6, -26.2),
        "url": "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/"
        "VehiclePositions",
        "licence": "Translink, CC BY 4.0",
    },
]


def overlaps(a: tuple, b: tuple) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def parse_feed(data: bytes, key: str, now: float) -> list[dict]:
    """A GTFS-Realtime FeedMessage's vehicles with a position, heard
    from in the last STALE_S seconds (or without a time)."""
    msg = gtfs_realtime_pb2.FeedMessage()
    msg.ParseFromString(data)
    out, seen = [], set()
    for e in msg.entity:
        if not e.HasField("vehicle") or not e.vehicle.HasField("position"):
            continue
        v = e.vehicle
        lat, lon = v.position.latitude, v.position.longitude
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat, lon) == (
            0,
            0,
        ):
            continue
        ts = int(v.timestamp or msg.header.timestamp or 0)
        if ts and now - ts > STALE_S:
            continue
        vid = v.vehicle.id or v.vehicle.label or e.id
        if not vid or vid in seen:
            continue
        seen.add(vid)
        out.append(
            {
                "id": "{0}:{1}".format(key, vid)[:80],
                "route": v.trip.route_id or None,
                "label": v.vehicle.label or None,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "bearing": round(v.position.bearing)
                if v.position.HasField("bearing") and v.position.bearing
                else None,
                "ts": ts or None,
            }
        )
    return out


class Transit:
    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=6.0),
            headers={"User-Agent": user_agent},
            follow_redirects=True,
        )
        # key -> (fetched at, vehicles); last good answer kept on errors.
        self.cache: dict[str, tuple[float, list[dict]]] = {}
        self.tried: dict[str, float] = {}
        self.locks = {f["key"]: asyncio.Lock() for f in FEEDS}

    async def close(self) -> None:
        await self.client.aclose()

    async def _feed(self, feed: dict) -> list[dict]:
        key = feed["key"]
        async with self.locks[key]:
            hit = self.cache.get(key)
            if time.monotonic() - self.tried.get(key, -MIN_AGE_S) < MIN_AGE_S:
                return hit[1] if hit else []
            self.tried[key] = time.monotonic()
            try:
                r = await self.client.get(feed["url"])
                r.raise_for_status()
                if len(r.content) > MAX_BYTES:
                    raise ValueError("feed too large")
                vehicles = parse_feed(r.content, key, time.time())
            except (httpx.HTTPError, ValueError, DecodeError) as exc:
                log.info("transit {0}: {1}".format(key, exc))
                return hit[1] if hit else []
            self.cache[key] = (time.monotonic(), vehicles)
            return vehicles

    async def in_view(self, w: float, s: float, e: float, n: float) -> dict:
        view = (w, s, e, n)
        feeds = [f for f in FEEDS if overlaps(view, f["bbox"])]
        results = await asyncio.gather(*(self._feed(f) for f in feeds))
        vehicles = []
        operators = []
        for feed, found in zip(feeds, results, strict=True):
            inside = [
                dict(v, operator=feed["key"])
                for v in found
                if w <= v["lon"] <= e and s <= v["lat"] <= n
            ]
            if inside:
                operators.append(
                    {
                        "key": feed["key"],
                        "name": feed["name"],
                        "licence": feed["licence"],
                        "count": len(inside),
                    }
                )
            vehicles += inside
        return {
            "status": "ok",
            "vehicles": vehicles[:MAX_VEHICLES],
            "operators": operators,
        }
