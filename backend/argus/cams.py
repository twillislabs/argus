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

- DriveBC (British Columbia, no key): drivebc.ca/api/webcams/.
- TfL JamCams (London, no key; "Powered by TfL Open Data"): stills and
  short MP4 clips, api.tfl.gov.uk/Place/Type/JamCam.
- Digitraffic weather cameras (Finland, no key, CC BY 4.0 Fintraffic):
  one camera per preset, weathercam.digitraffic.fi/<preset>.jpg.

Each camera: {id, name, road, place, direction (degrees or None), lat,
lon, agency, image, stream (HLS), clip (MP4), refresh_s}. The worker
keeps the catalogue in server_settings["layer:trafficcams"].
"""

import logging
import re
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("argus.cams")

CALTRANS = "https://cwwp2.dot.ca.gov/data/d{0}/cctv/cctvStatusD{0:02d}.json"
CALTRANS_DISTRICTS = range(1, 13)
TDOT = "https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras"
DRIVEBC = "https://www.drivebc.ca/api/webcams/"
DRIVEBC_IMAGE = "https://www.drivebc.ca/images/{0}.jpg"
TFL = "https://api.tfl.gov.uk/Place/Type/JamCam"
DIGITRAFFIC = "https://tie.digitraffic.fi/api/weathercam/v1/stations"
DIGITRAFFIC_IMAGE = "https://weathercam.digitraffic.fi/{0}.jpg"
# Digitraffic asks clients to say who they are in this header.
DIGITRAFFIC_USER = {"Digitraffic-User": "Argus/self-hosted"}

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
                "clip": None,
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
                "stream": stream
                if isinstance(stream, str)
                and stream.startswith("https://")
                and ".m3u8" in stream
                else None,
                "clip": None,
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


def parse_drivebc(items: list[dict]) -> list[dict]:
    out = []
    for c in items:
        if not c.get("is_on", True) or not c.get("should_appear", True):
            continue
        coords = (c.get("location") or {}).get("coordinates") or []
        if len(coords) < 2 or c.get("id") is None:
            continue
        out.append(
            {
                "id": "drivebc-{0}".format(int(c["id"])),
                "name": (c.get("name_override") or c.get("name") or "Camera")[
                    :120
                ],
                "road": "Highway {0}".format(c["highway_display"])
                if c.get("highway_display")
                else None,
                "place": (c.get("caption") or c.get("region_name") or "")[:160]
                or None,
                "direction": bearing(c.get("orientation")),
                "lat": round(float(coords[1]), 6),
                "lon": round(float(coords[0]), 6),
                "agency": "DriveBC",
                "image": DRIVEBC_IMAGE.format(int(c["id"])),
                "stream": None,
                "clip": None,
                "refresh_s": 300,
            }
        )
    return out


def parse_tfl(items: list[dict]) -> list[dict]:
    out = []
    for c in items:
        props = {
            p.get("key"): p.get("value")
            for p in c.get("additionalProperties") or []
        }
        if str(props.get("available", "true")).lower() != "true":
            continue
        image, lat, lon = props.get("imageUrl"), c.get("lat"), c.get("lon")
        if not image or lat is None or lon is None:
            continue
        clip = props.get("videoUrl") or ""
        cid = str(c.get("id", "")).replace("JamCams_", "")
        out.append(
            {
                "id": "tfl-{0}".format(re.sub(r"[^A-Za-z0-9_.-]", "", cid)),
                "name": (c.get("commonName") or "JamCam")[:120],
                "road": None,
                "place": (props.get("view") or "London")[:160],
                "direction": None,
                "lat": round(float(lat), 6),
                "lon": round(float(lon), 6),
                "agency": "TfL JamCams",
                "image": image,
                "stream": None,
                "clip": clip if clip.startswith("https://") else None,
                "refresh_s": 300,
            }
        )
    return out


def parse_digitraffic(doc: dict) -> list[dict]:
    out = []
    for f in doc.get("features") or []:
        p = f.get("properties") or {}
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2 or p.get("collectionStatus") not in (
            None,
            "GATHERING",
        ):
            continue
        presets = [x for x in p.get("presets") or [] if x.get("inCollection")]
        for n, preset in enumerate(presets):
            out.append(
                {
                    "id": "digitraffic-{0}".format(preset["id"]),
                    "name": (p.get("name") or "Weather camera").replace(
                        "_", " "
                    )[:110]
                    + (" ({0})".format(n + 1) if len(presets) > 1 else ""),
                    "road": None,
                    "place": "Finland",
                    "direction": None,
                    # Presets of one station share a spot: spread them a
                    # little so each can be clicked.
                    "lat": round(float(coords[1]) + n * 0.00012, 6),
                    "lon": round(float(coords[0]), 6),
                    "agency": "Fintraffic (Digitraffic)",
                    "image": DIGITRAFFIC_IMAGE.format(preset["id"]),
                    "stream": None,
                    "clip": None,
                    "refresh_s": 600,
                }
            )
    return out


async def fetch_drivebc(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(DRIVEBC)
    r.raise_for_status()
    body = r.json()
    return parse_drivebc(body if isinstance(body, list) else [])


async def fetch_tfl(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(TFL)
    r.raise_for_status()
    body = r.json()
    return parse_tfl(body if isinstance(body, list) else [])


async def fetch_digitraffic(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(DIGITRAFFIC, headers=DIGITRAFFIC_USER)
    r.raise_for_status()
    return parse_digitraffic(r.json())


# Feeds that need no key, by name, for the worker.
OPEN_FEEDS = {
    "drivebc": fetch_drivebc,
    "tfl": fetch_tfl,
    "digitraffic": fetch_digitraffic,
}


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
