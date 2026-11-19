"""US airport status from the FAA's National Airspace System status feed
(nasstatus.faa.gov, public, no key): ground stops, ground delay
programs, general arrival/departure delays and closure notices, by
airport code (the FAA's three-letter codes match IATA for the large
airports Argus shows).

Fetched by the API only when someone opens an airport, cached two
minutes and shared. Items are parsed by their airport element rather
than a fixed schema, so a new kind of delay still comes through.
"""

import logging
import time

import httpx
from defusedxml import ElementTree

log = logging.getLogger("argus.faa")

URL = "https://nasstatus.faa.gov/api/airport-status-information"
TTL_S = 120
MAX_BYTES = 1_000_000


def _kind(name: str) -> str:
    low = name.lower()
    if "ground stop" in low:
        return "ground_stop"
    if "ground delay" in low:
        return "ground_delay"
    if "closure" in low:
        return "closure"
    if "arrival" in low or "departure" in low:
        return "delay"
    return "other"


def _text(el) -> str:
    return " ".join((el.text or "").split())[:400]


def _item(kind: str, el) -> dict:
    item = {"kind": kind}
    for child in el:
        if child.tag == "ARPT":
            continue
        if len(child):
            # Arrival_Departure Type="Departure" with Min/Max/Trend.
            if child.get("Type"):
                item["direction"] = child.get("Type")
            for sub in child:
                item[sub.tag.lower()] = _text(sub)
        else:
            item[child.tag.lower()] = _text(child)
    if kind == "closure":
        reason = item.get("reason", "").upper()
        # Notices closing the airport only to some traffic (unscheduled
        # general aviation and the like), not a full closure.
        item["partial"] = any(
            w in reason for w in ("NON SKED", " EXC ", " TRANSIENT ")
        )
    return item


def parse_status(xml: bytes | str) -> dict:
    """{updated, airports: {code: [item, ...]}} from the feed."""
    root = ElementTree.fromstring(xml)
    airports: dict[str, list[dict]] = {}
    for group in root.iter("Delay_type"):
        kind = _kind(group.findtext("Name") or "")
        for el in group.iter():
            code = (el.findtext("ARPT") or "").strip().upper()
            if not code or el.tag == "Delay_type":
                continue
            if not code.isalnum() or len(code) > 4:
                continue
            airports.setdefault(code, []).append(_item(kind, el))
    return {
        "updated": (root.findtext("Update_Time") or "").strip() or None,
        "airports": airports,
    }


class FaaStatus:
    """The latest status, fetched at most every TTL_S seconds."""

    def __init__(self, user_agent: str) -> None:
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
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
            r = await self.client.get(URL)
            r.raise_for_status()
            if len(r.content) > MAX_BYTES:
                raise ValueError("the FAA status is too large")
            status = parse_status(r.content) | {"status": "ok"}
        except (httpx.HTTPError, ValueError, ElementTree.ParseError) as exc:
            log.warning("FAA status fetch failed: {0}".format(exc))
            if self.cached:
                # Keep showing the last answer, marked stale; try again
                # in a minute rather than on every request.
                stale = self.cached[1] | {"status": "stale"}
                self.cached = (now - TTL_S / 2, stale)
                return stale
            return {"updated": None, "airports": {}, "status": "error"}
        self.cached = (now, status)
        return status
