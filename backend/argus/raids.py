"""Air-raid alerts, fetched by the API on demand and cached 20 seconds:

- Ukraine: every oblast's alert state from ubilling.net.ua's public
  relay of the official air-raid map (no key). Occupied areas under a
  continuous alert since 2022 are marked long_running.
- Israel: Tzeva Adom's public relay of Home Front Command alerts (the
  official oref.org.il feed only answers from Israel; never work around
  that): what's sounding now, and the last 24 hours, by locality, placed
  from Tzeva Adom's locality list (fetched daily).
"""

import logging
import time
import zlib
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger("argus.raids")

UKRAINE = "https://ubilling.net.ua/aerialalerts/"
IL_NOW = "https://api.tzevaadom.co.il/notifications"
IL_HISTORY = "https://api.tzevaadom.co.il/alerts-history"
IL_PLACES = "https://www.tzevaadom.co.il/static/cities.json"
KYIV = ZoneInfo("Europe/Kyiv")
TTL_S = 20
PLACES_TTL_S = 86400
RECENT = timedelta(hours=24)
LONG_RUNNING = timedelta(days=7)
ATTRIBUTION = (
    "Ukraine: official air-raid map via ubilling.net.ua · Israel: Home "
    "Front Command alerts via Tzeva Adom"
)

# Oblast names in the feed, with English names and a point near the
# middle of each (Kyiv city is its own entry).
OBLASTS = {
    "Вінницька область": ("Vinnytsia Oblast", 49.10, 28.60),
    "Волинська область": ("Volyn Oblast", 51.20, 25.00),
    "Дніпропетровська область": ("Dnipropetrovsk Oblast", 48.40, 34.90),
    "Донецька область": ("Donetsk Oblast", 48.00, 37.80),
    "Житомирська область": ("Zhytomyr Oblast", 50.60, 28.40),
    "Закарпатська область": ("Zakarpattia Oblast", 48.40, 23.30),
    "Запорізька область": ("Zaporizhzhia Oblast", 47.30, 35.70),
    "Івано-Франківська область": ("Ivano-Frankivsk Oblast", 48.70, 24.40),
    "Київська область": ("Kyiv Oblast", 50.20, 30.70),
    "Кіровоградська область": ("Kirovohrad Oblast", 48.40, 32.00),
    "Луганська область": ("Luhansk Oblast", 48.80, 39.20),
    "Львівська область": ("Lviv Oblast", 49.80, 23.90),
    "Миколаївська область": ("Mykolaiv Oblast", 47.30, 31.90),
    "Одеська область": ("Odesa Oblast", 46.60, 30.00),
    "Полтавська область": ("Poltava Oblast", 49.60, 34.00),
    "Рівненська область": ("Rivne Oblast", 51.00, 26.40),
    "Сумська область": ("Sumy Oblast", 50.90, 34.00),
    "Тернопільська область": ("Ternopil Oblast", 49.40, 25.50),
    "Харківська область": ("Kharkiv Oblast", 49.60, 36.50),
    "Херсонська область": ("Kherson Oblast", 46.60, 33.40),
    "Хмельницька область": ("Khmelnytskyi Oblast", 49.40, 26.90),
    "Черкаська область": ("Cherkasy Oblast", 49.20, 31.50),
    "Чернівецька область": ("Chernivtsi Oblast", 48.20, 25.90),
    "Чернігівська область": ("Chernihiv Oblast", 51.30, 32.00),
    "м. Київ": ("Kyiv (city)", 50.45, 30.52),
    "Севастополь": ("Sevastopol", 44.60, 33.52),
}

# Tzeva Adom's threat ids (from its site's own table).
THREATS = {
    0: "Rockets and missiles",
    1: "Hazardous materials",
    2: "Terrorist infiltration",
    3: "Earthquake",
    4: "Tsunami",
    5: "Hostile aircraft",
    6: "Non-conventional missile",
    7: "Radiological event",
    8: "Alert",
    9: "Drill",
}


def parse_ukraine(doc: dict, now: datetime | None = None) -> list[dict]:
    """Every known oblast with its state; the active ones first."""
    now = now or datetime.now(UTC)
    out = []
    for name, state in (doc.get("states") or {}).items():
        known = OBLASTS.get(name)
        if not known or not isinstance(state, dict):
            continue
        try:
            # The relay gives Kyiv local time.
            changed = (
                datetime.strptime(
                    str(state.get("changed")), "%Y-%m-%d %H:%M:%S"
                )
                .replace(tzinfo=KYIV)
                .astimezone(UTC)
            )
        except ValueError:
            changed = None
        active = bool(state.get("alertnow"))
        out.append(
            {
                "id": "ua:{0}".format(known[0].split(" ")[0].lower()),
                "name": known[0],
                "lat": known[1],
                "lon": known[2],
                "active": active,
                "since": changed.isoformat() if changed else None,
                "long_running": bool(
                    active and changed and now - changed > LONG_RUNNING
                ),
            }
        )
    out.sort(key=lambda r: (not r["active"], r["long_running"], r["name"]))
    return out


def parse_places(doc: dict) -> dict[str, tuple[str, float, float]]:
    """Hebrew locality name -> (English name, lat, lon)."""
    out = {}
    for he, c in ((doc or {}).get("cities") or {}).items():
        try:
            out[he] = (
                str(c.get("en") or he),
                float(c["lat"]),
                float(c["lng"]),
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


def parse_israel(now_doc, history_doc, places, now: float | None = None):
    """Localities alerted now and in the last 24 hours (newest per place
    and threat), placed where the locality list knows them."""
    now = now or time.time()
    since = now - RECENT.total_seconds()
    found: dict[tuple[str, int], dict] = {}

    def add(he: str, at: float, threat: int, drill: bool, active: bool):
        if drill or threat == 9 or at < since:
            return
        place = places.get(he)
        if place is None:
            return
        key = (he, threat)
        cur = found.get(key)
        if cur and cur["at"] >= at and not active:
            return
        found[key] = {
            "id": "il:{0}:{1}".format(zlib.crc32(he.encode("utf-8")), threat),
            "name": place[0],
            "lat": place[1],
            "lon": place[2],
            "threat": threat,
            "threat_label": THREATS.get(threat, "Alert"),
            "at": at,
            "time": datetime.fromtimestamp(at, UTC).isoformat(),
            "active": active or (cur or {}).get("active", False),
        }

    for group in history_doc if isinstance(history_doc, list) else []:
        for a in (group or {}).get("alerts") or []:
            for he in a.get("cities") or []:
                add(
                    str(he),
                    float(a.get("time") or 0),
                    int(a.get("threat") or 0),
                    bool(a.get("isDrill")),
                    False,
                )
    for a in now_doc if isinstance(now_doc, list) else []:
        for he in a.get("cities") or []:
            add(
                str(he),
                float(a.get("time") or now),
                int(a.get("threat") or 0),
                bool(a.get("isDrill")),
                True,
            )
    out = sorted(found.values(), key=lambda r: (not r["active"], -r["at"]))
    for r in out:
        r.pop("at", None)
    return out


class Raids:
    """The latest picture, shared and cached TTL_S seconds."""

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            headers={"User-Agent": user_agent},
        )
        self.cached: tuple[float, dict] | None = None
        self.places: tuple[float, dict] | None = None

    async def close(self) -> None:
        await self.client.aclose()

    async def _json(self, url: str):
        r = await self.client.get(url)
        r.raise_for_status()
        return r.json()

    async def _places(self) -> dict:
        if self.places and time.monotonic() - self.places[0] < PLACES_TTL_S:
            return self.places[1]
        try:
            found = parse_places(await self._json(IL_PLACES))
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Tzeva Adom places failed: {0}".format(exc))
            return self.places[1] if self.places else {}
        self.places = (time.monotonic(), found)
        return found

    async def get(self) -> dict:
        now = time.monotonic()
        if self.cached and now - self.cached[0] < TTL_S:
            return self.cached[1]
        prev = self.cached[1] if self.cached else {}
        out = {
            "attribution": ATTRIBUTION,
            "fetched": datetime.now(UTC).isoformat(),
        }
        try:
            out["ukraine"] = parse_ukraine(await self._json(UKRAINE))
            out["ukraine_status"] = "ok"
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Ukraine alerts failed: {0}".format(exc))
            out["ukraine"] = prev.get("ukraine", [])
            out["ukraine_status"] = "stale" if prev.get("ukraine") else "error"
        try:
            places = await self._places()
            out["israel"] = parse_israel(
                await self._json(IL_NOW), await self._json(IL_HISTORY), places
            )
            out["israel_status"] = "ok"
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Israel alerts failed: {0}".format(exc))
            out["israel"] = prev.get("israel", [])
            out["israel_status"] = "stale" if prev.get("israel") else "error"
        self.cached = (now, out)
        return out
