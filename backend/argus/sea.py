"""Vessels: AIS messages from AISStream, the live picture, ship types.

The worker keeps one WebSocket to AISStream (an admin's free API key)
subscribed to the whole world, merges position and static messages per
vessel (MMSI), and publishes what changed every few seconds on NATS
argus.sea. The API keeps the latest picture in memory (LiveSea) and
answers map queries by bounding box.

Message shapes follow AISStream's v0 JSON: {"MessageType": ...,
"MetaData": {"MMSI", "ShipName", "latitude", "longitude", "time_utc"},
"Message": {<MessageType>: {...}}}.
"""

import time
from collections import deque
from typing import Any

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
MESSAGE_TYPES = [
    "PositionReport",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "ShipStaticData",
    "StaticDataReport",
]

# Vessels that stop reporting drop off: moving ones after 30 minutes,
# anything after 6 hours (moored ships report rarely).
STALE_MOVING_S = 30 * 60
STALE_ANY_S = 6 * 3600

# AIS ship type (first digit, or exact code) to an Argus category.
CATEGORIES = ("cargo", "tanker", "passenger", "fishing", "military", "other")


def category(ship_type: int | None) -> str:
    t = ship_type or 0
    if t == 30:
        return "fishing"
    if t in (35, 55):  # military ops, law enforcement
        return "military"
    if 60 <= t <= 69:
        return "passenger"
    if 70 <= t <= 79:
        return "cargo"
    if 80 <= t <= 89:
        return "tanker"
    return "other"


SHIP_TYPES = {
    30: "Fishing",
    31: "Towing",
    32: "Towing (large)",
    33: "Dredging",
    34: "Diving operations",
    35: "Military operations",
    36: "Sailing",
    37: "Pleasure craft",
    50: "Pilot vessel",
    51: "Search and rescue",
    52: "Tug",
    53: "Port tender",
    54: "Anti-pollution",
    55: "Law enforcement",
    58: "Medical transport",
}


def type_name(ship_type: int | None) -> str | None:
    t = ship_type or 0
    if t in SHIP_TYPES:
        return SHIP_TYPES[t]
    for low, name in (
        (40, "High-speed craft"),
        (60, "Passenger"),
        (70, "Cargo"),
        (80, "Tanker"),
        (20, "Wing in ground"),
    ):
        if low <= t <= low + 9:
            return name
    return None


NAV_STATUS = {
    0: "Under way using engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way sailing",
    14: "AIS-SART active",
}

# Maritime identification digits (first three of the MMSI) for the flags
# seen most. Others show as unknown.
MID = {
    201: "Albania",
    205: "Belgium",
    209: "Cyprus",
    210: "Cyprus",
    211: "Germany",
    212: "Cyprus",
    214: "Moldova",
    215: "Malta",
    218: "Germany",
    219: "Denmark",
    220: "Denmark",
    224: "Spain",
    225: "Spain",
    226: "France",
    227: "France",
    228: "France",
    229: "Malta",
    230: "Finland",
    231: "Faroe Islands",
    232: "United Kingdom",
    233: "United Kingdom",
    234: "United Kingdom",
    235: "United Kingdom",
    236: "Gibraltar",
    237: "Greece",
    238: "Croatia",
    239: "Greece",
    240: "Greece",
    241: "Greece",
    244: "Netherlands",
    245: "Netherlands",
    246: "Netherlands",
    247: "Italy",
    248: "Malta",
    249: "Malta",
    250: "Ireland",
    255: "Portugal (Madeira)",
    256: "Malta",
    257: "Norway",
    258: "Norway",
    259: "Norway",
    261: "Poland",
    263: "Portugal",
    265: "Sweden",
    266: "Sweden",
    271: "Turkey",
    272: "Ukraine",
    273: "Russia",
    275: "Latvia",
    276: "Estonia",
    277: "Lithuania",
    304: "Antigua and Barbuda",
    305: "Antigua and Barbuda",
    308: "Bahamas",
    309: "Bahamas",
    310: "Bermuda",
    311: "Bahamas",
    312: "Belize",
    314: "Barbados",
    316: "Canada",
    319: "Cayman Islands",
    338: "United States",
    339: "Jamaica",
    345: "Mexico",
    351: "Panama",
    352: "Panama",
    353: "Panama",
    354: "Panama",
    355: "Panama",
    356: "Panama",
    357: "Panama",
    366: "United States",
    367: "United States",
    368: "United States",
    369: "United States",
    370: "Panama",
    371: "Panama",
    372: "Panama",
    373: "Panama",
    374: "Panama",
    375: "St Vincent and the Grenadines",
    376: "St Vincent and the Grenadines",
    377: "St Vincent and the Grenadines",
    403: "Saudi Arabia",
    412: "China",
    413: "China",
    414: "China",
    416: "Taiwan",
    419: "India",
    422: "Iran",
    428: "Israel",
    431: "Japan",
    432: "Japan",
    440: "South Korea",
    441: "South Korea",
    445: "North Korea",
    457: "Mongolia",
    466: "Qatar",
    470: "United Arab Emirates",
    471: "United Arab Emirates",
    477: "Hong Kong",
    503: "Australia",
    511: "Palau",
    512: "New Zealand",
    518: "Cook Islands",
    525: "Indonesia",
    533: "Malaysia",
    538: "Marshall Islands",
    548: "Philippines",
    563: "Singapore",
    564: "Singapore",
    565: "Singapore",
    566: "Singapore",
    567: "Thailand",
    572: "Tuvalu",
    574: "Vietnam",
    576: "Vanuatu",
    577: "Vanuatu",
    601: "South Africa",
    613: "Cameroon",
    616: "Comoros",
    622: "Egypt",
    626: "Gabon",
    636: "Liberia",
    637: "Liberia",
    657: "Nigeria",
    667: "Sierra Leone",
    671: "Togo",
    674: "Tanzania",
    677: "Tanzania",
    701: "Argentina",
    710: "Brazil",
    720: "Bolivia",
    725: "Chile",
    730: "Colombia",
    775: "Venezuela",
}


def flag(mmsi: int) -> str | None:
    text = str(mmsi)
    if len(text) != 9:
        return None
    return MID.get(int(text[:3]))


def _num(value: Any, invalid: float | None = None) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return None if invalid is not None and v >= invalid else v


def parse(message: dict) -> dict | None:
    """One AISStream message to a partial vessel update, or None."""
    kind = message.get("MessageType")
    meta = message.get("MetaData") or {}
    body = (message.get("Message") or {}).get(kind) or {}
    mmsi = meta.get("MMSI") or body.get("UserID")
    if not mmsi or kind not in MESSAGE_TYPES:
        return None
    update: dict[str, Any] = {"mmsi": int(mmsi)}
    name = (meta.get("ShipName") or "").strip()
    if name:
        update["name"] = name
    if "Position" in kind:
        lat = _num(body.get("Latitude", meta.get("latitude")))
        lon = _num(body.get("Longitude", meta.get("longitude")))
        # 91 / 181 mean "not available" in AIS.
        if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180:
            return None
        update.update(
            {
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "sog": _num(body.get("Sog"), invalid=102.3),
                "cog": _num(body.get("Cog"), invalid=360),
                "heading": _num(body.get("TrueHeading"), invalid=511),
                "pos_at": time.time(),
            }
        )
        status = body.get("NavigationalStatus")
        if status is not None:
            update["status"] = NAV_STATUS.get(int(status))
        if kind == "ExtendedClassBPositionReport" and body.get("Type"):
            update["ship_type"] = int(body["Type"])
    if kind == "ShipStaticData":
        dim = body.get("Dimension") or {}
        eta = body.get("Eta") or {}
        update.update(
            {
                "name": (body.get("Name") or name).strip() or None,
                "callsign": (body.get("CallSign") or "").strip() or None,
                "imo": int(body["ImoNumber"])
                if body.get("ImoNumber")
                else None,
                "ship_type": int(body.get("Type") or 0) or None,
                "destination": (body.get("Destination") or "").strip() or None,
                "draught": _num(body.get("MaximumStaticDraught")),
                "length": (dim.get("A") or 0) + (dim.get("B") or 0) or None,
                "beam": (dim.get("C") or 0) + (dim.get("D") or 0) or None,
                "eta": (
                    "{0:02d}-{1:02d} {2:02d}:{3:02d}".format(
                        eta.get("Month", 0),
                        eta.get("Day", 0),
                        eta.get("Hour", 0),
                        eta.get("Minute", 0),
                    )
                    if eta.get("Month")
                    else None
                ),
            }
        )
    if kind == "StaticDataReport":
        report = body.get("ReportB") or {}
        part_a = body.get("ReportA") or {}
        if part_a.get("Name"):
            update["name"] = part_a["Name"].strip()
        if report.get("ShipType"):
            update["ship_type"] = int(report["ShipType"])
        if report.get("CallSign"):
            update["callsign"] = report["CallSign"].strip()
    return update


def _first(d: dict, *keys):
    for k in keys:
        if d.get(k) not in (None, ""):
            return d[k]
    return None


def parse_aiscatcher(doc) -> list[dict]:
    """Vessels from an AIS-catcher web server (ships.json), as updates in
    the same shape parse() makes. Field names vary a little between
    versions, so a few spellings are accepted."""
    ships = doc.get("ships", []) if isinstance(doc, dict) else doc or []
    now = time.time()
    out = []
    for s in ships:
        mmsi = _first(s, "mmsi", "MMSI")
        lat = _num(_first(s, "lat", "latitude"))
        lon = _num(_first(s, "lon", "longitude"))
        if not mmsi or lat is None or lon is None:
            continue
        if abs(lat) > 90 or abs(lon) > 180:
            continue
        age = _num(_first(s, "last_signal", "age"))
        update = {
            "mmsi": int(mmsi),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "sog": _num(_first(s, "speed", "sog"), invalid=102.3),
            "cog": _num(_first(s, "cog", "course"), invalid=360),
            "heading": _num(_first(s, "heading", "hdg"), invalid=511),
            "pos_at": now - (age or 0),
            "name": (str(_first(s, "shipname", "name") or "")).strip() or None,
            "callsign": (str(_first(s, "callsign") or "")).strip() or None,
            "destination": (str(_first(s, "destination") or "")).strip()
            or None,
            "draught": _num(_first(s, "draught")),
            "source": "local",
        }
        imo = _first(s, "imo", "IMO")
        if imo:
            update["imo"] = int(imo)
        ship_type = _first(s, "shiptype", "ship_type", "type")
        if isinstance(ship_type, int | float) and ship_type:
            update["ship_type"] = int(ship_type)
        status = _first(s, "status", "nav_status")
        if isinstance(status, int):
            update["status"] = NAV_STATUS.get(status)
        out.append(update)
    return out


def public(v: dict) -> dict:
    """A vessel as the API returns it."""
    t = v.get("ship_type")
    return {
        "mmsi": v["mmsi"],
        "name": v.get("name"),
        "callsign": v.get("callsign"),
        "imo": v.get("imo"),
        "flag": flag(v["mmsi"]),
        "ship_type": t,
        "type": type_name(t),
        "category": category(t),
        "lat": v.get("lat"),
        "lon": v.get("lon"),
        "sog": v.get("sog"),
        "cog": v.get("cog"),
        "heading": v.get("heading"),
        "status": v.get("status"),
        "destination": v.get("destination"),
        "eta": v.get("eta"),
        "draught": v.get("draught"),
        "length": v.get("length"),
        "beam": v.get("beam"),
        "age_s": round(time.time() - v["pos_at"]) if v.get("pos_at") else None,
    }


class LiveSea:
    """Latest state per vessel, merged from position and static data,
    plus a short track (a position every TRACK_EVERY_S, about eight
    hours) for pattern checks (argus/patterns.py)."""

    TRACK_EVERY_S = 300
    TRACK_POINTS = 96

    def __init__(self) -> None:
        self.vessels: dict[int, dict] = {}
        self.tracks: dict[int, deque] = {}
        self.updated = 0.0

    def apply(self, updates: list[dict], now: float | None = None) -> None:
        now = now or time.time()
        for u in updates:
            v = self.vessels.setdefault(u["mmsi"], {"mmsi": u["mmsi"]})
            v.update({k: val for k, val in u.items() if val is not None})
            if u.get("lat") is not None and u.get("lon") is not None:
                at = u.get("pos_at") or now
                track = self.tracks.setdefault(
                    u["mmsi"], deque(maxlen=self.TRACK_POINTS)
                )
                if not track or at - track[-1][2] >= self.TRACK_EVERY_S:
                    track.append((u["lon"], u["lat"], at))
        self.updated = now

    def prune(self, now: float | None = None) -> int:
        now = now or time.time()
        drop = []
        for mmsi, v in self.vessels.items():
            age = now - v.get("pos_at", 0)
            moving = (v.get("sog") or 0) > 0.5
            if age > STALE_ANY_S or (moving and age > STALE_MOVING_S):
                drop.append(mmsi)
        for mmsi in drop:
            self.vessels.pop(mmsi, None)
            self.tracks.pop(mmsi, None)
        return len(drop)

    def positioned(self) -> list[dict]:
        return [v for v in self.vessels.values() if "lat" in v]

    def in_bbox(self, bbox, limit: int = 4000) -> tuple[list[dict], int]:
        """Vessels in the box, most interesting first, and the total."""
        hits = []
        for v in self.positioned():
            if bbox is not None:
                w, s, e, n = bbox
                if not s <= v["lat"] <= n:
                    continue
                inside = (
                    w <= v["lon"] <= e
                    if w <= e
                    else (v["lon"] >= w or v["lon"] <= e)
                )
                if not inside:
                    continue
            hits.append(v)
        rank = {"military": 0, "tanker": 1, "passenger": 2, "cargo": 3}
        hits.sort(
            key=lambda v: (
                rank.get(category(v.get("ship_type")), 4),
                -(v.get("pos_at") or 0),
            )
        )
        return hits[:limit], len(hits)

    def find(self, query: str, limit: int = 5) -> list[dict]:
        q = query.strip().upper()
        if not q:
            return []
        exact, prefix = [], []
        for v in self.positioned():
            name = (v.get("name") or "").upper()
            ids = (str(v["mmsi"]), str(v.get("imo") or ""), v.get("callsign"))
            if q in ids or name == q:
                exact.append(v)
            elif len(q) >= 3 and name.startswith(q):
                prefix.append(v)
        return (exact + prefix)[:limit]
