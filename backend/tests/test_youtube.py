from argus import youtube

LIVE = (
    '<html><link rel="canonical" '
    'href="https://www.youtube.com/watch?v=53SxFKpbKDE">'
    '..."isLive":true...</html>'
)
OFFLINE = (
    '<html><link rel="canonical" '
    'href="https://www.youtube.com/channel/UCJHAT3Uvv-g3I8H3GhHWV7w">'
    "</html>"
)
CHANNEL = "UCoMdktPbSTixAyNGwb-UYkQ"


def test_parse_live():
    assert youtube.parse_live(LIVE) == "53SxFKpbKDE"
    assert youtube.parse_live(OFFLINE) is None
    # A watch canonical without isLive is a past stream or a premiere.
    assert youtube.parse_live(LIVE.replace('"isLive":true', "")) is None


async def test_resolve_caches(monkeypatch):
    ids = youtube.LiveIds("test")
    calls = []

    async def fake_fetch(channel):
        calls.append(channel)
        return {"status": "live", "video_id": "53SxFKpbKDE"}, 600

    monkeypatch.setattr(ids, "_fetch", fake_fetch)
    first = await ids.resolve(CHANNEL)
    second = await ids.resolve(CHANNEL)
    assert first == second == {"status": "live", "video_id": "53SxFKpbKDE"}
    assert calls == [CHANNEL]
    await ids.close()


async def test_live_endpoint(app, admin_client, monkeypatch):
    app_state = app.state

    async def fake_resolve(channel):
        return {"status": "offline", "video_id": None}

    monkeypatch.setattr(app_state.youtube, "resolve", fake_resolve)
    bad = await admin_client.get("/api/news/live/not-a-channel")
    assert bad.status_code == 422
    ok = await admin_client.get("/api/news/live/{0}".format(CHANNEL))
    assert ok.status_code == 200
    assert ok.json()["status"] == "offline"
