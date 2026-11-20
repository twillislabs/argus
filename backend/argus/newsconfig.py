"""The news feeds and live channels, as an admin has set them.

Both start as Argus's built-in lists (rss.DEFAULT_FEEDS, or the file
named by ARGUS_RSS_FEEDS_FILE, and BUILTIN_CHANNELS below). Once an
admin edits either in Settings, the edited list is kept in
server_settings ("news:feeds", "news:channels") and replaces the
built-in one; resetting deletes it, so the built-in list (and whatever
a release adds to it) applies again.

Feeds: {outlet, url, section, based ("us" or "world": where the outlet
is based, for telling US stories from world ones), enabled}.
Channels: {id, name, short, group, platform ("youtube" or "rumble"),
enabled}.
"""

import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from argus.models import ServerSetting

FEEDS_KEY = "news:feeds"
CHANNELS_KEY = "news:channels"
MAX_FEEDS = 200
MAX_CHANNELS = 80

# Outlets in the built-in feeds based outside the US.
NON_US_OUTLETS = {
    "The Guardian", "BBC News", "GB News", "France 24", "Al Jazeera",
    "DW", "Kyiv Independent", "Times of Israel", "Sky News",
    "The Telegraph", "The Spectator", "Daily Express", "The Times",
    "Daily Mail",
}  # fmt: skip


# Sections for built-in feeds whose address doesn't say (a whole-site
# feed): world desks, the UK press, business, and the conservative
# outlets the default list leans on.
OUTLET_SECTIONS = {
    "Al Jazeera": "World", "France 24": "World", "Times of Israel": "World",
    "Kyiv Independent": "World", "Washington Examiner": "Politics",
    "The Telegraph": "UK", "GB News": "UK", "Daily Mail": "UK",
    "Fox Business": "Business", "Alex Jones Live": "Conservative",
    "Daily Wire": "Conservative", "Washington Times": "Conservative",
    "Daily Caller": "Conservative", "Breitbart": "Conservative",
    "The Blaze": "Conservative", "Just the News": "Conservative",
    "National Review": "Conservative", "The Federalist": "Conservative",
    "Washington Free Beacon": "Conservative",
    "The Daily Signal": "Conservative", "Townhall": "Conservative",
    "RedState": "Conservative", "PJ Media": "Conservative",
    "The American Conservative": "Conservative",
}  # fmt: skip
NPR_SECTIONS = {"1004": "World", "1003": "US", "1001": "General"}


def section_for(url: str, outlet: str = "") -> str:
    """A section name for a built-in feed, from its address or outlet."""
    u = url.lower()
    m = re.search(r"feeds\.npr\.org/(\d+)/", u)
    if m and m.group(1) in NPR_SECTIONS:
        return NPR_SECTIONS[m.group(1)]
    if re.search(r"/us[-_/.]|us-news|usheadlines|us_and_canada|/us$", u):
        return "US"
    if "politics" in u:
        return "Politics"
    if re.search(r"world|international|rss-en-world", u):
        return "World"
    return OUTLET_SECTIONS.get(outlet, "General")


def builtin_feeds(settings: Any = None) -> list[dict]:
    from argus.collectors.rss import DEFAULT_FEEDS

    path = getattr(settings, "rss_feeds_file", None) if settings else None
    base = DEFAULT_FEEDS
    if path:
        with open(path, encoding="utf-8") as f:
            base = json.load(f)
    return [clean_feed(f) for f in base if isinstance(f, dict)]


def clean_feed(f: dict) -> dict:
    outlet = " ".join(str(f.get("outlet") or "").split())[:80]
    url = str(f.get("url") or "").strip()[:500]
    based = f.get("based")
    if based not in ("us", "world"):
        based = "world" if outlet in NON_US_OUTLETS else "us"
    return {
        "outlet": outlet,
        "url": url,
        "section": " ".join(
            str(f.get("section") or section_for(url, outlet)).split()
        )[:40]
        or "General",
        "based": based,
        "enabled": f.get("enabled", True) is not False,
    }


# Live channels with a true live stream (24/7, or a live TV simulcast),
# plus Ryan Hall, Y'all, live through major weather events. IDs were
# checked against each channel's public feed (2026-11-20).
BUILTIN_CHANNELS = [
    {"id": "UCJg9wBPyKMNA5sRDnvzmkdg", "name": "LiveNOW from FOX",
     "short": "LiveNOW", "group": "US"},
    {"id": "UCx6h-dWzJ5NpAlja1YsApdg", "name": "Newsmax",
     "short": "Newsmax", "group": "US"},
    {"id": "UCeY0bbntWzzVIaj2z3QigXg", "name": "NBC News", "short": "NBC",
     "group": "US"},
    {"id": "UC8p1vwvWtl6T73JiExfWs1g", "name": "CBS News", "short": "CBS",
     "group": "US"},
    {"id": "UCBi2mrWuNuyYy4gbM6fU18Q", "name": "ABC News", "short": "ABC",
     "group": "US"},
    {"id": "TheAlexJonesShowLive", "name": "Alex Jones Live",
     "short": "Alex Jones", "group": "US", "platform": "rumble"},
    {"id": "UC0vn8ISa4LKMunLbzaXLnOQ", "name": "GB News",
     "short": "GB News", "group": "International"},
    {"id": "UCSrZ3UV4jOidv8ppoVuvW9Q", "name": "Euronews",
     "short": "Euronews", "group": "International"},
    {"id": "UC83jt4dlz1Gjl58fzQrrKZg", "name": "CNA", "short": "CNA",
     "group": "International"},
    {"id": "UC16niRr50-MSBwiO3YDb3RA", "name": "BBC News", "short": "BBC",
     "group": "International"},
    {"id": "UCNye-wNBqNL5ZzHSJj3l8Bg", "name": "Al Jazeera English",
     "short": "Al Jazeera", "group": "International"},
    {"id": "UCknLrEdhRCp1aegoMqRaCZg", "name": "DW News", "short": "DW",
     "group": "International"},
    {"id": "UCQfwfsi5VrQ8yKZ-UWmAEFg", "name": "France 24 English",
     "short": "France 24", "group": "International"},
    {"id": "UC7fWeaHhqgM4Ry-RMpM2YYw", "name": "TRT World", "short": "TRT",
     "group": "International"},
    {"id": "UC_gUM8rL-Lrg6O3adPW9K1g", "name": "WION", "short": "WION",
     "group": "International"},
    {"id": "UCSPEjw8F2nQDtmUKPFNF7_A", "name": "NHK WORLD-JAPAN",
     "short": "NHK", "group": "International"},
    {"id": "UCIALMKvObZNtJ6AmdCLP7Lg", "name": "Bloomberg Television",
     "short": "Bloomberg", "group": "Business"},
    {"id": "UCJHAT3Uvv-g3I8H3GhHWV7w", "name": "Ryan Hall, Y'all",
     "short": "Ryan Hall", "group": "Weather"},
    {"id": "UC1FbPiXx59_ltnFVx7IxWow", "name": "FOX Weather",
     "short": "FOX Weather", "group": "Weather"},
]  # fmt: skip


def clean_channel(c: dict) -> dict:
    name = " ".join(str(c.get("name") or "").split())[:80]
    return {
        "id": str(c.get("id") or "").strip()[:80],
        "name": name,
        "short": " ".join(str(c.get("short") or name).split())[:24],
        "group": " ".join(str(c.get("group") or "Other").split())[:40]
        or "Other",
        "platform": "rumble" if c.get("platform") == "rumble" else "youtube",
        "enabled": c.get("enabled", True) is not False,
    }


async def _stored(db: AsyncSession, key: str) -> list[dict] | None:
    row = await db.get(ServerSetting, key)
    if row is None or not isinstance(row.value, dict):
        return None
    items = row.value.get("items")
    return items if isinstance(items, list) else None


async def feeds(db: AsyncSession, settings: Any = None) -> list[dict]:
    """Every feed, the admin's list if there is one."""
    stored = await _stored(db, FEEDS_KEY)
    if stored is None:
        return builtin_feeds(settings)
    return [clean_feed(f) for f in stored if isinstance(f, dict)]


async def channels(db: AsyncSession) -> list[dict]:
    stored = await _stored(db, CHANNELS_KEY)
    source = BUILTIN_CHANNELS if stored is None else stored
    return [clean_channel(c) for c in source if isinstance(c, dict)]


async def customised(db: AsyncSession, key: str) -> bool:
    return await _stored(db, key) is not None
