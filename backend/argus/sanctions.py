"""Ship sanctions and risk flags from OpenSanctions' maritime dataset
(data.opensanctions.org, CC BY-NC 4.0: free for non-commercial use, with
attribution; never bundled). The worker's sanctions_loop fetches it
daily into server_settings["layer:sanctions"]; the API matches live
ships against it by IMO number, then MMSI, never by name alone.

Risk tags in the dataset, as Argus shows them:
  sanction     on a government sanctions list (OFAC, EU, UK, UN ...)
  mare.shadow  named as part of the "shadow fleet" moving sanctioned oil
  poi          on a war-related list (Ukraine's war sanctions portal)
  mare.detained, reg.warn  port state control detentions and warnings
"""

import csv
import io
import logging
import time

import httpx

from argus.models import ServerSetting

log = logging.getLogger("argus.sanctions")

INDEX = "https://data.opensanctions.org/datasets/latest/maritime/index.json"
ENTITY = "https://www.opensanctions.org/entities/{0}/"
ATTRIBUTION = "OpenSanctions (CC BY-NC 4.0), maritime dataset"
RELOAD_S = 600

LABELS = {
    "sanction": "Sanctioned",
    "mare.shadow": "Shadow fleet",
    "poi": "War-related list",
    "mare.detained": "Detained in port inspection",
    "reg.warn": "Regulator warning",
}
# What a map ring and an alert mean; detentions and warnings are only
# listed in the ship's panel.
SERIOUS = ("sanction", "mare.shadow", "poi")


def _imo(v: str) -> str | None:
    digits = "".join(c for c in (v or "") if c.isdigit())
    return digits if len(digits) == 7 else None


def _mmsi(v: str) -> str | None:
    digits = "".join(c for c in (v or "") if c.isdigit())
    return digits if len(digits) == 9 else None


def parse(text: str) -> dict:
    """{"imo": {imo: [entry ...]}, "mmsi": {mmsi: [entry ...]}, "count"}
    with entry [name, risks, datasets, id, flag], vessels only."""
    by_imo: dict[str, list] = {}
    by_mmsi: dict[str, list] = {}
    count = 0
    for row in csv.DictReader(io.StringIO(text)):
        if (row.get("type") or "").upper() != "VESSEL":
            continue
        risks = [r for r in (row.get("risk") or "").split(";") if r]
        if not risks:
            continue
        entry = [
            (row.get("caption") or "")[:120],
            risks,
            [d for d in (row.get("datasets") or "").split(";") if d][:8],
            (row.get("id") or "")[:120],
            (row.get("flag") or "")[:3],
        ]
        imo, mmsi = _imo(row.get("imo") or ""), _mmsi(row.get("mmsi") or "")
        if not imo and not mmsi:
            continue
        count += 1
        if imo:
            by_imo.setdefault(imo, []).append(entry)
        if mmsi:
            by_mmsi.setdefault(mmsi, []).append(entry)
    return {"imo": by_imo, "mmsi": by_mmsi, "count": count}


async def fetch(client: httpx.AsyncClient) -> dict:
    r = await client.get(INDEX)
    r.raise_for_status()
    index = r.json()
    url = next(
        (
            x.get("url")
            for x in index.get("resources") or []
            if x.get("name") == "maritime.csv"
        ),
        None,
    )
    if not url or not str(url).startswith("https://data.opensanctions.org/"):
        raise ValueError("no maritime.csv in the OpenSanctions index")
    r = await client.get(url)
    r.raise_for_status()
    found = parse(r.text)
    found["updated"] = index.get("updated_at")
    return found


def _entry(e: list) -> dict:
    name, risks, datasets, eid, flag = e
    return {
        "name": name,
        "risks": risks,
        "labels": [LABELS.get(r, r) for r in risks],
        "datasets": datasets,
        "flag": flag,
        "url": ENTITY.format(eid) if eid else None,
    }


class SanctionsIndex:
    """The latest list, reloaded from the database when the worker has
    fetched a new one (checked every RELOAD_S)."""

    def __init__(self) -> None:
        self.data: dict = {"imo": {}, "mmsi": {}, "count": 0}
        self.stamp = None
        # None: never checked, so the first call always loads (a monotonic
        # clock can read under RELOAD_S just after the machine boots).
        self.checked: float | None = None

    async def refresh(self, db) -> None:
        if (
            self.checked is not None
            and time.monotonic() - self.checked < RELOAD_S
        ):
            return
        self.checked = time.monotonic()
        row = await db.get(ServerSetting, "layer:sanctions")
        value = (row.value or {}) if row else {}
        if value.get("fetched") and value.get("fetched") != self.stamp:
            self.data = value.get("list") or self.data
            self.stamp = value.get("fetched")

    def match(self, mmsi=None, imo=None) -> list[dict]:
        """Every listing for a ship: by IMO (reliable), then MMSI."""
        seen, out = set(), []
        hits = []
        if imo:
            hits += self.data.get("imo", {}).get(str(imo), [])
        if mmsi:
            hits += self.data.get("mmsi", {}).get(str(mmsi), [])
        for e in hits:
            if e[3] in seen:
                continue
            seen.add(e[3])
            out.append(_entry(e))
        return out

    def flags(self, mmsi=None, imo=None) -> list[str]:
        """The serious risk tags for a ship, for its map ring."""
        tags = []
        for e in self.match(mmsi, imo):
            for r in e["risks"]:
                if r in SERIOUS and r not in tags:
                    tags.append(r)
        return tags
