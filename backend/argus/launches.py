"""Rocket launches from The Space Devs' Launch Library 2 (free tier, no
key, 15 requests an hour per IP): the next two weeks of launches and the
last three days', fetched by the worker every two hours (two requests)
into server_settings["layer:launches"].
"""

from datetime import UTC, datetime, timedelta

import httpx

BASE = "https://ll.thespacedevs.com/2.3.0/launches/"
ATTRIBUTION = "Launch data from The Space Devs Launch Library 2"
AHEAD = timedelta(days=14)
BEHIND = timedelta(days=3)


def _text(v, limit: int) -> str | None:
    if not isinstance(v, str):
        return None
    v = " ".join(v.split())
    return v[:limit] or None


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse(doc: dict) -> list[dict]:
    out = []
    for r in doc.get("results") or []:
        pad = r.get("pad") or {}
        lat, lon = _num(pad.get("latitude")), _num(pad.get("longitude"))
        if lat is None or lon is None or not r.get("id"):
            continue
        status = r.get("status") or {}
        mission = r.get("mission") or {}
        orbit = mission.get("orbit") or {}
        provider = r.get("launch_service_provider") or {}
        rocket = (r.get("rocket") or {}).get("configuration") or {}
        location = pad.get("location") or {}
        precision = r.get("net_precision") or {}
        out.append(
            {
                "id": str(r["id"])[:40],
                "name": _text(r.get("name"), 160) or "Launch",
                "net": r.get("net"),
                "precision": _text(precision.get("name"), 40),
                "window_start": r.get("window_start"),
                "window_end": r.get("window_end"),
                "status": _text(status.get("abbrev"), 20) or "TBD",
                "status_name": _text(status.get("name"), 60),
                "provider": _text(provider.get("name"), 120),
                "rocket": _text(
                    rocket.get("full_name") or rocket.get("name"), 80
                ),
                "mission": _text(mission.get("name"), 160),
                "description": _text(mission.get("description"), 500),
                "mission_type": _text(mission.get("type"), 40),
                "orbit": _text(orbit.get("abbrev"), 12),
                "pad": _text(pad.get("name"), 120),
                "location": _text(location.get("name"), 160),
                "country": _text((pad.get("country") or {}).get("name"), 60),
                "pad_wiki": pad["wiki_url"]
                if str(pad.get("wiki_url") or "").startswith("https://")
                else None,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "probability": r.get("probability")
                if isinstance(r.get("probability"), int)
                else None,
                "webcast_live": bool(r.get("webcast_live")),
            }
        )
    return out


async def fetch(client: httpx.AsyncClient, now: datetime | None = None):
    now = now or datetime.now(UTC)
    stamp = "%Y-%m-%dT%H:%M:%SZ"
    found: dict[str, dict] = {}
    for params in (
        {
            "net__gte": (now - BEHIND).strftime(stamp),
            "net__lte": now.strftime(stamp),
            "ordering": "-net",
        },
        {
            "net__gte": now.strftime(stamp),
            "net__lte": (now + AHEAD).strftime(stamp),
            "ordering": "net",
        },
    ):
        r = await client.get(
            BASE, params={"limit": 60, "mode": "normal", **params}
        )
        r.raise_for_status()
        for item in parse(r.json()):
            found[item["id"]] = item
    return sorted(found.values(), key=lambda x: x["net"] or "")
