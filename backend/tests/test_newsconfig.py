from unittest.mock import AsyncMock, patch

from argus import newsconfig, youtube
from argus.collectors.rss import DEFAULT_FEEDS, RssCollector
from tests.conftest import csrf

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Bridge closes after crash</title><link>https://x.example/1</link>
<pubDate>Fri, 20 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>"""


def test_builtin_feeds_have_sections_and_regions():
    feeds = newsconfig.builtin_feeds()
    assert len(feeds) == len(DEFAULT_FEEDS)
    by_url = {f["url"]: f for f in feeds}
    assert by_url["https://feeds.npr.org/1003/rss.xml"]["based"] == "us"
    bbc = by_url["https://feeds.bbci.co.uk/news/world/rss.xml"]
    assert bbc["based"] == "world" and bbc["section"] == "World"
    assert by_url["https://www.cbsnews.com/latest/rss/us"]["section"] == "US"
    # Sections say what a feed covers, never an outlet's politics.
    assert {f["section"] for f in feeds} <= {
        "World",
        "US",
        "Politics",
        "UK",
        "Business",
    }


async def test_feeds_edit_reset_and_worker(admin_client, app):
    r = (await admin_client.get("/api/admin/news/feeds")).json()
    assert not r["customised"] and len(r["items"]) == len(DEFAULT_FEEDS)
    items = [
        {"outlet": "Local Paper", "url": "https://paper.example/rss",
         "section": "Local", "based": "us", "enabled": True},
        {"outlet": "Off", "url": "https://off.example/rss",
         "section": "Local", "based": "us", "enabled": False},
    ]  # fmt: skip
    r = await admin_client.put(
        "/api/admin/news/feeds",
        json={"items": items},
        headers=csrf(admin_client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["customised"] and len(r.json()["items"]) == 2
    # The worker reads the admin's list, skipping disabled feeds.
    collector = RssCollector(app.state.settings)
    async with app.state.db.sessionmaker() as db:
        await collector.prepare(db)
    assert [f["outlet"] for f in collector.feeds()] == ["Local Paper"]
    # Loopback and duplicate addresses are refused.
    bad = await admin_client.put(
        "/api/admin/news/feeds",
        json={"items": [dict(items[0], url="http://127.0.0.1/rss")]},
        headers=csrf(admin_client),
    )
    assert bad.status_code == 422
    dup = await admin_client.put(
        "/api/admin/news/feeds",
        json={"items": [items[0], items[0]]},
        headers=csrf(admin_client),
    )
    assert dup.status_code == 422
    r = await admin_client.delete(
        "/api/admin/news/feeds", headers=csrf(admin_client)
    )
    assert not r.json()["customised"]


async def test_feed_test_parses(admin_client):
    class Resp:
        status_code = 200
        content = RSS

    with patch("httpx.AsyncClient.get", AsyncMock(return_value=Resp())):
        r = await admin_client.post(
            "/api/admin/news/feeds/test",
            json={"url": "https://paper.example/rss"},
            headers=csrf(admin_client),
        )
    body = r.json()
    assert body["ok"] and body["titles"] == ["Bridge closes after crash"]


async def test_channels_edit_and_me(admin_client):
    me = (await admin_client.get("/api/me")).json()
    assert len(me["channels"]) == len(newsconfig.BUILTIN_CHANNELS)
    items = [
        {"id": "UCJg9wBPyKMNA5sRDnvzmkdg", "name": "LiveNOW from FOX",
         "short": "LiveNOW", "group": "US", "platform": "youtube"},
        {"id": "UCx6h-dWzJ5NpAlja1YsApdg", "name": "Newsmax",
         "short": "Newsmax", "group": "US", "enabled": False},
    ]  # fmt: skip
    r = await admin_client.put(
        "/api/admin/news/channels",
        json={"items": items},
        headers=csrf(admin_client),
    )
    assert r.status_code == 200, r.text
    me = (await admin_client.get("/api/me")).json()
    assert [c["name"] for c in me["channels"]] == ["LiveNOW from FOX"]
    bad = await admin_client.put(
        "/api/admin/news/channels",
        json={"items": [dict(items[0], id="not-a-channel!")]},
        headers=csrf(admin_client),
    )
    assert bad.status_code == 422


def test_channel_input_forms():
    p = youtube.parse_channel_input
    assert p("UCJg9wBPyKMNA5sRDnvzmkdg") == (
        "youtube",
        "UCJg9wBPyKMNA5sRDnvzmkdg",
    )
    assert p("https://www.youtube.com/channel/UCJg9wBPyKMNA5sRDnvzmkdg/live")[
        1
    ] == ("UCJg9wBPyKMNA5sRDnvzmkdg")
    assert p("https://www.youtube.com/@LiveNOWFOX") == ("handle", "LiveNOWFOX")
    assert p("@LiveNOWFOX") == ("handle", "LiveNOWFOX")
    assert p("https://rumble.com/c/TheAlexJonesShowLive") == (
        "rumble",
        "TheAlexJonesShowLive",
    )
    assert p("just words") is None
