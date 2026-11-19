"""Travel advisories: the US State Department's levels (1-4) and the UK
FCDO's warnings against travel, per country.

- US: cadataapi.state.gov/api/TravelAdvisories, one JSON list (public
  domain). The level is in the title ("Iran - Level 4: Do Not Travel").
- UK: GOV.UK's content API (Open Government Licence). The index lists
  every country with its last update; a country's own page carries
  `alert_status`. Only countries updated since the last pass are fetched
  again.

Names are matched to Natural Earth's short names (the map's country
shapes) with NE_NAME; the worker keeps the result in
server_settings["layer:advisories"].
"""

import asyncio
import html
import re

import httpx

US_URL = "https://cadataapi.state.gov/api/TravelAdvisories"
UK_INDEX = "https://www.gov.uk/api/content/foreign-travel-advice"
UK_PAGE = "https://www.gov.uk/api/content/foreign-travel-advice/{0}"
UK_GAP_S = 0.3  # between GOV.UK requests

US_LEVELS = {
    1: "Exercise normal precautions",
    2: "Exercise increased caution",
    3: "Reconsider travel",
    4: "Do not travel",
}
# FCDO alert_status: (level on the US-style 1-4 scale, plain text).
UK_STATUS = {
    "avoid_all_travel_to_whole_country": (4, "Advises against all travel"),
    "avoid_all_travel_to_parts": (
        3,
        "Advises against all travel to parts",
    ),
    "avoid_all_but_essential_travel_to_whole_country": (
        3,
        "Advises against all but essential travel",
    ),
    "avoid_all_but_essential_travel_to_parts": (
        2,
        "Advises against all but essential travel to parts",
    ),
}

# US and UK names -> Natural Earth short names (frontend countries-50m).
NE_NAME = {
    "USA": "United States of America",
    "North Macedonia": "Macedonia",
    "São Tomé and Príncipe": "São Tomé and Principe",
    "Sao Tome and Principe": "São Tomé and Principe",
    "Macau": "Macao",
    "Bosnia and Herzegovina": "Bosnia and Herz.",
    "Gaza": "Palestine",
    "The West Bank": "Palestine",
    "The Occupied Palestinian Territories": "Palestine",
    "Saint Barthelemy": "St-Barthélemy",
    "French Saint Martin": "St-Martin",
    "The Bahamas": "Bahamas",
    "Democratic Republic of the Congo": "Dem. Rep. Congo",
    "Republic of Congo": "Congo",
    "Eswatini": "eSwatini",
    "Federated States of Micronesia": "Micronesia",
    "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
    "St Vincent and the Grenadines": "St. Vin. and Gren.",
    "Turks and Caicos Islands": "Turks and Caicos Is.",
    "Saint Kitts and Nevis": "St. Kitts and Nevis",
    "St Kitts and Nevis": "St. Kitts and Nevis",
    "St Lucia": "Saint Lucia",
    "St Maarten": "Sint Maarten",
    "St Pierre & Miquelon": "St. Pierre and Miquelon",
    "Mexico Travel Advisory": "Mexico",
    "British Virgin Islands": "British Virgin Is.",
    "Cayman Islands": "Cayman Is.",
    "Marshall Islands": "Marshall Is.",
    "Solomon Islands": "Solomon Is.",
    "Falkland Islands": "Falkland Is.",
    "Cook Islands, Tokelau and Niue": "Cook Is.",
    "Pitcairn Island": "Pitcairn Is.",
    "Wallis and Futuna": "Wallis and Futuna Is.",
    "Antigua and Barbuda": "Antigua and Barb.",
    "South Sudan": "S. Sudan",
    "Burma": "Myanmar",
    "Myanmar (Burma)": "Myanmar",
    "Côte d’Ivoire": "Côte d'Ivoire",
    "The Kyrgyz Republic": "Kyrgyzstan",
    "The Gambia": "Gambia",
    "Central African Republic": "Central African Rep.",
    "Equatorial Guinea": "Eq. Guinea",
    "Dominican Republic": "Dominican Rep.",
    "French Polynesia": "Fr. Polynesia",
    "Naoero": "Nauru",
    "Western Sahara": "W. Sahara",
    "Cape Verde": "Cabo Verde",
    "British Indian Ocean Territory": "Br. Indian Ocean Ter.",
    "St Helena, Ascension and Tristan da Cunha": "Saint Helena",
    "South Georgia and the South Sandwich Islands": "S. Geo. and the Is.",
    "Antarctica/British Antarctic Territory": "Antarctica",
}
# One UK page covering two map shapes.
NE_SPLIT = {"St Martin and St Barthélemy": ("St-Martin", "St-Barthélemy")}


def ne_names(name: str) -> tuple[str, ...]:
    name = name.strip()
    return NE_SPLIT.get(name) or (NE_NAME.get(name, name),)


def _text(markup: str | None, limit: int) -> str:
    plain = re.sub(r"<[^>]+>", " ", markup or "")
    plain = re.sub(r"\s+", " ", html.unescape(plain)).strip()
    plain = re.sub(r"\s+([.,;:!?])", r"\1", plain)
    if len(plain) <= limit:
        return plain
    return plain[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def parse_us(items: list[dict]) -> dict[str, dict]:
    """State Department list -> {Natural Earth name: advisory}; where two
    advisories map to one shape (Gaza, West Bank), the higher wins."""
    out: dict[str, dict] = {}
    for item in items:
        title = str(item.get("Title") or "")
        m = re.match(r"\s*(.+?)\s*-\s*Level\s*(\d)", title)
        if not m:
            continue
        level = int(m.group(2))
        if level not in US_LEVELS:
            continue
        advisory = {
            "level": level,
            "label": US_LEVELS[level],
            "title": title[:160],
            "summary": _text(item.get("Summary"), 600),
            "updated": item.get("Updated") or item.get("Published"),
            "url": str(item.get("Link") or "")[:300],
        }
        for ne in ne_names(m.group(1)):
            if ne not in out or out[ne]["level"] < level:
                out[ne] = advisory
    return out


def parse_uk_index(doc: dict) -> dict[str, dict]:
    """GOV.UK index -> {slug: {name, updated, url}}."""
    out = {}
    for child in (doc.get("links") or {}).get("children") or []:
        country = (child.get("details") or {}).get("country") or {}
        slug = country.get("slug")
        if not slug:
            continue
        out[slug] = {
            "name": country.get("name") or child.get("title") or slug,
            "updated": child.get("public_updated_at"),
            "url": child.get("web_url"),
            "change": _text(
                (child.get("details") or {}).get("change_description"), 300
            ),
        }
    return out


def uk_advisory(entry: dict, page: dict) -> dict:
    statuses = (page.get("details") or {}).get("alert_status") or []
    known = [UK_STATUS[s] for s in statuses if s in UK_STATUS]
    level, label = max(known) if known else (1, "No warnings against travel")
    return {
        "level": level,
        "label": label,
        "status": [s for s in statuses if s in UK_STATUS],
        "change": entry.get("change", ""),
        "updated": entry.get("updated"),
        "url": entry.get("url"),
    }


async def fetch(client: httpx.AsyncClient, previous: dict) -> dict:
    """Both sources. UK pages are re-fetched only when the index says the
    country changed since `previous` (the last stored value)."""
    us_resp = await client.get(US_URL)
    us_resp.raise_for_status()
    us = parse_us(us_resp.json())

    index_resp = await client.get(UK_INDEX)
    index_resp.raise_for_status()
    index = parse_uk_index(index_resp.json())
    old_pages = previous.get("uk_pages") or {}
    pages: dict[str, dict] = {}
    for slug, entry in index.items():
        old = old_pages.get(slug)
        if old and old.get("updated") == entry["updated"]:
            pages[slug] = old
            continue
        try:
            r = await client.get(UK_PAGE.format(slug))
            r.raise_for_status()
            pages[slug] = {
                "name": entry["name"],
                **uk_advisory(entry, r.json()),
            }
        except (httpx.HTTPError, ValueError):
            if old:
                pages[slug] = old
        await asyncio.sleep(UK_GAP_S)
    uk: dict[str, dict] = {}
    for page in pages.values():
        for ne in ne_names(page["name"]):
            if ne not in uk or uk[ne]["level"] < page["level"]:
                uk[ne] = page
    return {"us": us, "uk": uk, "uk_pages": pages}


def merged(value: dict) -> list[dict]:
    """One row per country with either advisory, worst first."""
    us = value.get("us") or {}
    uk = value.get("uk") or {}
    rows = []
    for name in set(us) | set(uk):
        a, b = us.get(name), uk.get(name)
        rows.append(
            {
                "country": name,
                "level": max(x["level"] for x in (a, b) if x),
                "us": a,
                "uk": b,
            }
        )
    rows.sort(key=lambda r: (-r["level"], r["country"]))
    return rows
