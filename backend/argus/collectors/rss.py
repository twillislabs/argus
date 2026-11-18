"""RSS / Atom news feeds.

The default list mixes outlets from across the political spectrum and
from several countries. Override it with a JSON file
(ARGUS_RSS_FEEDS_FILE) containing [{"outlet": "...", "url": "..."}, ...].

Each outlet's own terms apply; Argus stores only the headline, a short
excerpt and the link, and always links to the original.
"""

import html
import json
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx
from defusedxml import ElementTree

from argus.collectors.base import Collector, CollectResult, RawIn

DEFAULT_FEEDS = [
    {
        "outlet": "BBC News",
        "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
    },
    {"outlet": "NPR", "url": "https://feeds.npr.org/1004/rss.xml"},
    {
        "outlet": "Fox News",
        "url": "https://moxie.foxnews.com/google-publisher/world.xml",
    },
    {
        "outlet": "Wall Street Journal",
        "url": "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
    },
    {
        "outlet": "Al Jazeera",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
    },
    {"outlet": "DW", "url": "https://rss.dw.com/rdf/rss-en-world"},
    {"outlet": "The Guardian", "url": "https://www.theguardian.com/world/rss"},
    {"outlet": "France 24", "url": "https://www.france24.com/en/rss"},
    {
        "outlet": "Washington Examiner",
        "url": "https://www.washingtonexaminer.com/feed/",
    },
    {
        "outlet": "NBC News",
        "url": "https://feeds.nbcnews.com/nbcnews/public/world",
    },
    {
        "outlet": "ABC News",
        "url": "https://abcnews.go.com/abcnews/internationalheadlines",
    },
    {"outlet": "CBS News", "url": "https://www.cbsnews.com/latest/rss/world"},
    {"outlet": "New York Post", "url": "https://nypost.com/world-news/feed/"},
    {
        "outlet": "Times of Israel",
        "url": "https://www.timesofisrael.com/feed/",
    },
    {
        "outlet": "Kyiv Independent",
        "url": "https://kyivindependent.com/news-archive/rss/",
    },
]

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean(text: str | None, limit: int = 400) -> str:
    if not text:
        return ""
    plain = _WS.sub(" ", html.unescape(_TAG.sub(" ", text))).strip()
    if len(plain) > limit:
        plain = "{0}…".format(plain[: limit - 1].rsplit(" ", 1)[0])
    return plain


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(node, *names) -> str | None:
    for child in node:
        if _local(child.tag) in names and (child.text or "").strip():
            return child.text
    return None


def _link(node) -> str | None:
    for child in node:
        if _local(child.tag) != "link":
            continue
        if child.get("href"):
            rel = child.get("rel", "alternate")
            if rel == "alternate":
                return child.get("href")
        elif (child.text or "").strip():
            return child.text.strip()
    return None


def parse_feed(outlet: str, data: bytes, now: datetime) -> list[RawIn]:
    """Parse RSS 2.0, RSS 1.0 (RDF) or Atom into article records."""
    root = ElementTree.fromstring(data)
    items = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    records = []
    for item in items:
        title = clean(_child_text(item, "title"), 500)
        url = _link(item)
        if not title or not url or not url.startswith(("http://", "https://")):
            continue
        published = (
            parse_date(
                _child_text(item, "pubDate", "date", "published", "updated")
            )
            or now
        )
        summary = clean(
            _child_text(item, "description", "summary", "encoded", "content")
        )
        records.append(
            RawIn(
                source="rss",
                external_id=url[:160],
                kind="article",
                observed_at=min(published, now),
                payload={
                    "outlet": outlet,
                    "url": url[:1000],
                    "title": title,
                    "summary": summary,
                },
            )
        )
    return records


class RssCollector(Collector):
    name = "rss"
    label = "News feeds (RSS / Atom)"
    interval_s = 600
    licence = "Each outlet's terms; headline, excerpt and link only"

    def feeds(self) -> list[dict]:
        path = self.settings.rss_feeds_file
        if path:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        return DEFAULT_FEEDS

    async def collect(self, client: httpx.AsyncClient, cursor):
        now = datetime.now(UTC)
        records: list[RawIn] = []
        failures = []
        for feed in self.feeds():
            try:
                response = await client.get(feed["url"])
                if response.status_code != 200:
                    failures.append(feed["outlet"])
                    continue
                records.extend(
                    parse_feed(feed["outlet"], response.content, now)
                )
            except (httpx.HTTPError, ElementTree.ParseError, ValueError):
                failures.append(feed["outlet"])
        return CollectResult(records=records, failures=failures)
