"""Government traffic cameras: a daily catalogue from each agency's
public feed, and their still images proxied (and cached briefly) by the
API, so browsers never call the agencies directly.

Feeds:
- Caltrans CCTV (no key): one JSON file per district,
  cwwp2.dot.ca.gov/data/dN/cctv/cctvStatusDNN.json. "There is no charge
  for the use of this data" (dot.ca.gov/conditions-of-use).
- TDOT SmartWay (Tennessee), with a TDOT open-data API key (admins add
  it in Settings > Data sources): /opendata/api/public/RoadwayCameras,
  key in the apiKey header. Its fields aren't documented publicly, so
  the parser tries the usual names and logs the keys it got when none
  fit.

Each camera: {id, name, road, place, direction (degrees or None), lat,
lon, agency, image, stream, refresh_s}. The worker keeps the catalogue
in server_settings["layer:trafficcams"].
"""

import logging
import re
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("argus.cams")

CALTRANS = "https://cwwp2.dot.ca.gov/data/d{0}/cctv/cctvStatusD{0:02d}.json"
CALTRANS_DISTRICTS = range(1, 13)
TDOT = "https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras"

COMPASS = {
    "north": 0,
    "northeast": 45,
    "east": 90,
    "southeast": 135,
    "south": 180,
    "southwest": 225,
    "west": 270,
    "northwest": 315,
    "n": 0,
    "ne": 45,
    "e": 90,
    "se": 135,
    "s": 180,
    "sw": 225,
    "w": 270,
    "nw": 315,
    "nb": 0,
    "eb": 90,
    "sb": 180,
    "wb": 270,
}


def bearing(text) -> float | None:
    if text is None or text == "":
        return None
    if isinstance(text, (int, float)):
        return float(text) % 360
    key = re.sub(r"[^a-z]", "", str(text).lower().replace("bound", ""))
    if key in COMPASS:
        return float(COMPASS[key])
    try:
        return float(text) % 360
    except ValueError:
        return None


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_caltrans(doc: dict, district: int) -> list[dict]:
    out = []
    for item in doc.get("data") or []:
        c = item.get("cctv") or {}
        if str(c.get("inService", "true")).lower() != "true":
            continue
        loc = c.get("location") or {}
        img = c.get("imageData") or {}
        static = img.get("static") or {}
        lat, lon = _num(loc.get("latitude")), _num(loc.get("longitude"))
        image = static.get("currentImageURL") or ""
        if lat is None or lon is None or not image.startswith("https://"):
            continue
        stream = img.get("streamingVideoURL") or ""
        out.append(
            {
                "id": "caltrans-d{0}-{1}".format(district, c.get("index")),
                "name": (loc.get("locationName") or "Camera")[:120],
                "road": loc.get("route") or None,
                "place": loc.get("nearbyPlace") or loc.get("county") or None,
                "direction": bearing(loc.get("direction")),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "agency": "Caltrans",
                "image": image,
                "stream": stream if stream.startswith("https://") else None,
                "refresh_s": max(
                    30,
                    int(_num(static.get("currentImageUpdateFrequency")) or 2)
                    * 60,
                ),
            }
        )
    return out


def _first(d: dict, *names):
    lower = {k.lower(): v for k, v in d.items()}
    for n in names:
        v = lower.get(n.lower())
        if v not in (None, ""):
            return v
    return None


def parse_tdot(items: list[dict]) -> list[dict]:
    out = []
    for c in items:
        lat = _num(_first(c, "lat", "latitude", "y"))
        lon = _num(_first(c, "lng", "lon", "long", "longitude", "x"))
        loc = _first(c, "location") or {}
        if (lat is None or lon is None) and isinstance(loc, dict):
            lat = _num(_first(loc, "lat", "latitude"))
            lon = _num(_first(loc, "lng", "lon", "longitude"))
        image = _first(
            c,
            "thumbnailUrl",
            "thumbnailURL",
            "imageUrl",
            "imageURL",
            "snapshotUrl",
            "jpegUrl",
            "image",
        )
        if lat is None or lon is None or not isinstance(image, str):
            continue
        stream = _first(
            c, "hlsUrl", "httpsVideoUrl", "httpVideoUrl", "videoUrl"
        )
        cid = _first(c, "id", "cameraId", "camId", "name")
        out.append(
            {
                "id": "tdot-{0}".format(
                    re.sub(r"[^A-Za-z0-9_.-]", "", str(cid))
                ),
                "name": str(
                    _first(c, "title", "description", "name") or "Camera"
                )[:120],
                "road": _first(c, "route", "roadway", "road"),
                "place": _first(c, "jurisdiction", "region", "county"),
                "direction": bearing(_first(c, "direction", "heading")),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "agency": "TDOT SmartWay",
                "image": image,
                "stream": stream if isinstance(stream, str) else None,
                "refresh_s": 60,
            }
        )
    if items and not out:
        log.warning(
            "TDOT cameras: no records parsed; first record keys: {0}".format(
                sorted(items[0])[:30]
            )
        )
    return out


async def fetch_caltrans(client: httpx.AsyncClient) -> list[dict]:
    cams: list[dict] = []
    failed = 0
    for d in CALTRANS_DISTRICTS:
        try:
            r = await client.get(CALTRANS.format(d))
            r.raise_for_status()
            cams += parse_caltrans(r.json(), d)
        except (httpx.HTTPError, ValueError) as exc:
            failed += 1
            log.warning("Caltrans D{0}: {1}".format(d, exc))
    if failed == len(CALTRANS_DISTRICTS):
        raise httpx.HTTPError("every Caltrans district failed")
    return cams


async def fetch_tdot(client: httpx.AsyncClient, key: str) -> list[dict]:
    r = await client.get(TDOT, headers={"apiKey": key})
    r.raise_for_status()
    body = r.json()
    return parse_tdot(body if isinstance(body, list) else [])


def image_allowed(url: str) -> bool:
    """The proxy only fetches a camera's own catalogue image, over https
    to a named host (never an address or this server)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    return (
        parts.scheme == "https"
        and "." in host
        and not re.fullmatch(r"[0-9.]+|\[.*\]", host)
        and host not in ("localhost",)
    )
