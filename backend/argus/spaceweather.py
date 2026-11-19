"""Space weather from NOAA's Space Weather Prediction Center (public
JSON, no key): the R/S/G scales (radio blackouts, solar radiation
storms, geomagnetic storms) now and forecast, the planetary Kp index,
and the alerts, watches and warnings of the last two days.

Fetched by the API when someone asks, cached ten minutes and shared.
"""

import logging
import re
import time
from datetime import UTC, datetime, timedelta

import httpx

log = logging.getLogger("argus.spaceweather")

BASE = "https://services.swpc.noaa.gov/products/"
TTL_S = 600
ALERT_WINDOW = timedelta(hours=48)
HEADLINE = re.compile(
    r"^(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CANCEL[A-Z ]*):\s*(.+)$",
    re.MULTILINE,
)
SCALE_NAMES = {
    "R": "Radio blackouts",
    "S": "Solar radiation storm",
    "G": "Geomagnetic storm",
}


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def parse_scales(doc: dict) -> dict:
    """{now: {R,S,G: {scale, text}}, forecast: [{date, R_minor, R_major,
    S, G}]}: key "0" is now, "1".."3" today and the next two days."""
    now = doc.get("0") or {}
    out = {
        "now": {
            k: {
                "scale": _int((now.get(k) or {}).get("Scale")) or 0,
                "text": (now.get(k) or {}).get("Text") or "none",
                "name": SCALE_NAMES[k],
            }
            for k in "RSG"
        },
        "forecast": [],
    }
    for key in ("1", "2", "3"):
        day = doc.get(key)
        if not isinstance(day, dict):
            continue
        r, s, g = day.get("R") or {}, day.get("S") or {}, day.get("G") or {}
        out["forecast"].append(
            {
                "date": day.get("DateStamp"),
                "r_minor_pct": _int(r.get("MinorProb")),
                "r_major_pct": _int(r.get("MajorProb")),
                "s_pct": _int(s.get("Prob")),
                "g_scale": _int(g.get("Scale")) or 0,
            }
        )
    return out


def parse_kp(rows: list) -> dict:
    """The latest planetary Kp, the highest of the last 24 hours, and the
    last eight readings (3-hourly)."""
    points = []
    for r in rows:
        if isinstance(r, dict):
            when, kp = r.get("time_tag"), r.get("Kp")
        elif isinstance(r, list) and len(r) >= 2 and r[0] != "time_tag":
            when, kp = r[0], r[1]
        else:
            continue
        try:
            points.append((str(when), float(kp)))
        except (TypeError, ValueError):
            continue
    if not points:
        return {"now": None, "at": None, "max_24h": None, "recent": []}
    recent = points[-8:]
    return {
        "now": recent[-1][1],
        "at": recent[-1][0],
        "max_24h": max(kp for _, kp in recent),
        "recent": [{"at": t, "kp": kp} for t, kp in recent],
    }


def parse_alerts(rows: list, now: datetime | None = None) -> list[dict]:
    """Alerts of the last two days, newest first, each with its headline."""
    now = now or datetime.now(UTC)
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            issued = datetime.strptime(
                str(r.get("issue_datetime"))[:19], "%Y-%m-%d %H:%M:%S"
            ).replace(tzinfo=UTC)
        except ValueError:
            continue
        if now - issued > ALERT_WINDOW:
            continue
        message = str(r.get("message") or "").replace("\r", "")
        m = HEADLINE.search(message)
        if not m:
            continue
        out.append(
            {
                "id": str(r.get("product_id") or "")[:12],
                "issued": issued.isoformat(),
                "kind": m.group(1).title(),
                "headline": m.group(2).strip()[:200],
                "message": message.strip()[:1500],
            }
        )
    out.sort(key=lambda a: a["issued"], reverse=True)
    return out[:20]


class SpaceWeather:
    """The latest picture, fetched at most every TTL_S seconds."""

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": user_agent},
        )
        self.cached: tuple[float, dict] | None = None

    async def close(self) -> None:
        await self.client.aclose()

    async def get(self) -> dict:
        now = time.monotonic()
        if self.cached and now - self.cached[0] < TTL_S:
            return self.cached[1]
        try:
            scales = await self._json("noaa-scales.json")
            kp = await self._json("noaa-planetary-k-index.json")
            alerts = await self._json("alerts.json")
            picture = {
                "status": "ok",
                "fetched": datetime.now(UTC).isoformat(),
                **parse_scales(scales if isinstance(scales, dict) else {}),
                "kp": parse_kp(kp if isinstance(kp, list) else []),
                "alerts": parse_alerts(
                    alerts if isinstance(alerts, list) else []
                ),
            }
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Space weather fetch failed: {0}".format(exc))
            if self.cached:
                stale = self.cached[1] | {"status": "stale"}
                self.cached = (now - TTL_S / 2, stale)
                return stale
            return {"status": "error"}
        self.cached = (now, picture)
        return picture

    async def _json(self, name: str):
        r = await self.client.get(BASE + name)
        r.raise_for_status()
        return r.json()
