"""Wikipedia's Current events portal: the day's stories, as editors list
them (CC BY-SA 4.0), placed on the map from the articles they link.

Each day's page (Portal:Current_events/2026_November_19) has category
headings ("Armed conflicts and attacks") over nested lists: the outer
items are story threads ("Russo-Ukrainian War"), the innermost items the
day's entries, with links to articles and to their news sources. The
worker reads the last few days through the MediaWiki API every hour and
keeps them in server_settings["layer:wikipedia"]; an entry is placed at
the most specific linked article with coordinates (a bridge or a town
before a district, a region or a country; organisations last).
"""

import asyncio
import re
from datetime import date, timedelta
from html.parser import HTMLParser
from urllib.parse import unquote

import httpx

API = "https://en.wikipedia.org/w/api.php"
PAGE = "Portal:Current_events/{0}_{1}_{2}"
WIKI = "https://en.wikipedia.org/wiki/"
DAYS = 3
GAP_S = 0.5  # between API requests
TEXT_MAX = 600

# How specific a linked article is as a place, best first, from its
# coordinate type and short description ("Country in South Asia").
# Wikipedia's "dim" (scale) is too often wrong to use (Chile: 1 km).
RANK_LANDMARK, RANK_TOWN, RANK_DISTRICT, RANK_REGION, RANK_COUNTRY = range(5)
RANK_ORG = 6  # organisations have coordinates for their headquarters
_ORG = re.compile(
    r"\b(party|military|armed forces|army|navy|air force|agency|company|"
    r"organi[sz]ation|ministry|government|police|militia|group|movement|"
    r"newspaper|broadcaster|university|club|team|league|people|ethnic)\b",
    re.IGNORECASE,
)


def place_rank(kind: str | None, description: str | None) -> int:
    d = (description or "").lower()
    if kind == "country" or re.match(
        r"(island )?(country|sovereign state|transcontinental country)", d
    ):
        return RANK_COUNTRY
    if _ORG.search(d) and not kind:
        return RANK_ORG
    if kind in ("adm1st", "state") or re.search(
        r"\b(state|province|region|territory|oblast|governorate)\b", d
    ):
        return RANK_REGION
    if kind == "adm2nd" or re.search(r"\b(district|county|prefecture)\b", d):
        return RANK_DISTRICT
    if kind in ("city", "adm3rd") or re.search(
        r"\b(city|town|village|place|capital|municipality|neighbou?rhood|"
        r"suburb|upazila|commune)\b",
        d,
    ):
        return RANK_TOWN
    if kind in ("landmark", "event", "airport", "edu", "railwaystation"):
        return RANK_LANDMARK
    return RANK_DISTRICT


def page_title(day: date) -> str:
    return PAGE.format(day.year, day.strftime("%B"), day.day)


class _Parser(HTMLParser):
    """Walks the parsed portal HTML into entries."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_content = False
        self.depth_div = 0
        self.category = ""
        self.in_heading = False
        self.heading = ""
        # One frame per open <li>: its text, links and sources so far.
        self.stack: list[dict] = []
        self.link: dict | None = None
        self.entries: list[dict] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div":
            if "current-events-content" in (a.get("class") or ""):
                self.in_content = True
                self.depth_div = 0
            elif self.in_content:
                self.depth_div += 1
            return
        if not self.in_content:
            return
        if tag == "p":
            self.in_heading = True
            self.heading = ""
        elif tag == "li":
            self.stack.append(
                {"text": "", "links": [], "sources": [], "nested": False}
            )
            if len(self.stack) > 1:
                self.stack[-2]["nested"] = True
        elif tag == "a" and self.stack:
            href = a.get("href") or ""
            if href.startswith("/wiki/") and ":" not in href[6:]:
                title = unquote(href[6:]).replace("_", " ")
                self.link = {"kind": "wiki", "title": title, "text": ""}
            elif "external" in (a.get("class") or "") and href.startswith(
                "http"
            ):
                self.link = {"kind": "source", "url": href, "text": ""}

    def handle_endtag(self, tag):
        if tag == "div" and self.in_content:
            if self.depth_div == 0:
                self.in_content = False
            else:
                self.depth_div -= 1
            return
        if not self.in_content:
            return
        if tag == "p" and self.in_heading:
            self.in_heading = False
            name = self.heading.strip()
            if name:
                self.category = name
        elif tag == "a" and self.link and self.stack:
            frame = self.stack[-1]
            if self.link["kind"] == "wiki":
                frame["links"].append(self.link["title"])
            else:
                frame["sources"].append(
                    {
                        "name": self.link["text"].strip("() ")[:60],
                        "url": self.link["url"][:500],
                    }
                )
            self.link = None
        elif tag == "li" and self.stack:
            frame = self.stack.pop()
            if not frame["nested"]:
                text = re.sub(r"\s+", " ", frame["text"]).strip()
                # Drop the trailing source names: "(AP) (Reuters)".
                text = re.sub(r"(\s*\([^()]{1,40}\))+\s*$", "", text)
                if text:
                    self.entries.append(
                        {
                            "category": self.category,
                            "topics": [
                                f["links"][0] for f in self.stack if f["links"]
                            ],
                            "text": text[:TEXT_MAX],
                            "links": frame["links"][:20],
                            "sources": frame["sources"][:6],
                        }
                    )

    def handle_data(self, data):
        if not self.in_content:
            return
        if self.in_heading:
            self.heading += data
        if self.link is not None:
            self.link["text"] += data
            if self.link["kind"] == "source":
                return  # "(AP)" isn't part of the story
        if self.stack:
            self.stack[-1]["text"] += data


def parse_day(html: str) -> list[dict]:
    p = _Parser()
    p.feed(html)
    return p.entries


def best_place(
    entry: dict, coords: dict[str, tuple[float, float, float]]
) -> tuple[float, float, str] | None:
    """The most specific linked article with coordinates: the entry's own
    links first, then its story threads'."""
    best = None
    for rank, titles in enumerate((entry["links"], entry["topics"])):
        for title in titles:
            hit = coords.get(title)
            if not hit:
                continue
            lat, lon, specific = hit
            key = (specific, rank)
            if best is None or key < best[0]:
                best = (key, (lat, lon, title))
    return best[1] if best else None


async def _get(client: httpx.AsyncClient, params: dict) -> dict:
    r = await client.get(API, params={**params, "format": "json"})
    r.raise_for_status()
    return r.json()


async def coordinates(
    client: httpx.AsyncClient, titles: list[str]
) -> dict[str, tuple[float, float, float]]:
    """Primary coordinates and place rank of articles, 50 a request,
    keyed by the title as linked (following redirects)."""
    out: dict[str, tuple[float, float, float]] = {}
    unique = list(dict.fromkeys(titles))
    for i in range(0, len(unique), 50):
        batch = unique[i : i + 50]
        try:
            doc = await _get(
                client,
                {
                    "action": "query",
                    "prop": "coordinates|description",
                    "coprop": "type",
                    "titles": "|".join(batch),
                    "redirects": 1,
                    "formatversion": 2,
                },
            )
        except httpx.HTTPError:
            break  # placed what we could; the next pass tries again
        q = doc.get("query") or {}
        # Linked name -> canonical title: normalised, then redirected.
        step = {
            x["from"]: x["to"]
            for x in (q.get("normalized") or []) + (q.get("redirects") or [])
        }
        found = {}
        for page in q.get("pages") or []:
            c = (page.get("coordinates") or [None])[0]
            if c:
                found[page["title"]] = (
                    float(c["lat"]),
                    float(c["lon"]),
                    place_rank(c.get("type"), page.get("description")),
                )
        for name in batch:
            title, hops = name, 0
            while title in step and hops < 4:
                title, hops = step[title], hops + 1
            if title in found:
                out[name] = found[title]
        await asyncio.sleep(GAP_S)
    return out


async def fetch(client: httpx.AsyncClient, today: date) -> list[dict]:
    """The last DAYS days of entries, newest first, placed where they
    can be."""
    entries = []
    for back in range(DAYS):
        day = today - timedelta(days=back)
        try:
            doc = await _get(
                client,
                {
                    "action": "parse",
                    "page": page_title(day),
                    "prop": "text",
                    "formatversion": 2,
                },
            )
        except httpx.HTTPStatusError as exc:
            # Rate limits and outages fail the pass, so the stored copy
            # stays; a missing page is just a day without entries.
            if exc.response.status_code in (429,) or (
                exc.response.status_code >= 500
            ):
                raise
            continue
        if "error" in doc:  # no page yet for today
            continue
        for i, e in enumerate(parse_day(doc["parse"]["text"])):
            e["date"] = day.isoformat()
            e["id"] = "{0}:{1}".format(day.isoformat(), i)
            entries.append(e)
        await asyncio.sleep(GAP_S)
    titles = [t for e in entries for t in e["links"] + e["topics"]]
    coords = await coordinates(client, titles) if titles else {}
    for e in entries:
        place = best_place(e, coords)
        e["lat"], e["lon"], e["place"] = place if place else (None, None, "")
        e["url"] = WIKI + page_title(date.fromisoformat(e["date"])).replace(
            " ", "_"
        )
    return entries
