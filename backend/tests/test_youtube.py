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


UPCOMING = (
    '<html><link rel="canonical" '
    'href="https://www.youtube.com/watch?v=Ps2rryOIn9k">'
    '"viewCount":{"runs":[{"text":"53"},{"text":" waiting"}]},"isLive":true'
    '"videoDetails":{"videoId":"Ps2rryOIn9k","title":"WATCH LIVE: tree",'
    '"thumbnail":{"thumbnails":[]},"isUpcoming":true,"isPrivate":false'
    '"scheduledStartTime":"1795186800"</html>'
)


def test_scheduled_stream_isnt_live():
    assert youtube.parse_live(UPCOMING) is None
    assert youtube.parse_upcoming(UPCOMING) == 1795186800
    assert youtube.parse_upcoming(LIVE) is None


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
    assert first == second
    assert first["video_id"] == "53SxFKpbKDE"
    assert first["platform"] == "youtube"
    assert calls == [CHANNEL]
    await ids.close()


async def test_live_endpoint(app, admin_client, monkeypatch):
    app_state = app.state

    async def fake_resolve(channel, platform="youtube"):
        return {"status": "offline", "video_id": None}

    monkeypatch.setattr(app_state.youtube, "resolve", fake_resolve)
    bad = await admin_client.get("/api/news/live/not-a-channel")
    assert bad.status_code == 422
    ok = await admin_client.get("/api/news/live/{0}".format(CHANNEL))
    assert ok.status_code == 200
    assert ok.json()["status"] == "offline"


RUMBLE_PAGE = (
    '<html><rum-videos-grid> <script type="application/json">'
    '{"items":[{"url":"https://rumble.com/v7go3hg-old.html","live":false,'
    '"livestream_status":0},{"url":"https://rumble.com/v7eh2s2-live.html",'
    '"live":true,"livestream_status":2}]}</script></rum-videos-grid>'
)


def test_parse_rumble_live():
    assert (
        youtube.parse_rumble_live(RUMBLE_PAGE)
        == "https://rumble.com/v7eh2s2-live.html"
    )
    ended = RUMBLE_PAGE.replace(
        '"livestream_status":2', '"livestream_status":0'
    )
    assert youtube.parse_rumble_live(ended) is None
    assert youtube.parse_rumble_live("<html></html>") is None


def test_valid_channel():
    assert youtube.valid_channel("youtube", CHANNEL)
    assert not youtube.valid_channel("youtube", "TheAlexJonesShowLive")
    assert youtube.valid_channel("rumble", "TheAlexJonesShowLive")
    assert not youtube.valid_channel("rumble", "../etc")
    assert not youtube.valid_channel("vimeo", CHANNEL)


async def test_rumble_endpoint(app, admin_client, monkeypatch):
    seen = []

    async def fake_resolve(channel, platform="youtube"):
        seen.append((channel, platform))
        return {"status": "live", "video_id": "v7capuk", "platform": platform}

    monkeypatch.setattr(app.state.youtube, "resolve", fake_resolve)
    ok = await admin_client.get(
        "/api/news/live/TheAlexJonesShowLive?platform=rumble"
    )
    assert ok.json()["video_id"] == "v7capuk"
    assert seen == [("TheAlexJonesShowLive", "rumble")]
    bad = await admin_client.get("/api/news/live/x?platform=vimeo")
    assert bad.status_code == 422
