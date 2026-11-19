from datetime import UTC, datetime

import httpx
import pytest

from argus import video

YT = {
    "items": [
        {
            "id": {"kind": "youtube#video", "videoId": "abcdefghijk"},
            "snippet": {
                "title": "Live:   Nashville  skyline",
                "channelTitle": "Cam Co",
                "publishedAt": "2026-11-19T10:00:00Z",
                "liveBroadcastContent": "live",
            },
        },
        {"id": {"kind": "youtube#channel", "channelId": "UCx"}},
        {"id": {"videoId": "bad id!"}},
    ]
}
WINDY = {
    "webcams": [
        {
            "webcamId": 1234567890,
            "title": "Nashville: Broadway",
            "status": "active",
            "location": {
                "latitude": 36.16,
                "longitude": -86.78,
                "city": "Nashville",
                "region": "Tennessee",
                "country": "United States",
            },
            "images": {
                "current": {"preview": "https://imgproxy.windy.com/x.jpg"}
            },
            "player": {
                "live": "https://webcams.windy.com/webcams/public/embed/player/1234567890/live",
                "day": "https://webcams.windy.com/webcams/public/embed/player/1234567890/day",
            },
            "urls": {"detail": "https://www.windy.com/webcams/1234567890"},
        },
        {"webcamId": 2, "location": {}},
    ]
}


def test_parsers():
    vids = video.parse_youtube(YT, live=True)
    assert [v["id"] for v in vids] == ["abcdefghijk"]
    assert vids[0]["title"] == "Live: Nashville skyline" and vids[0]["live"]
    cams = video.parse_windy(WINDY)
    assert len(cams) == 1
    c = cams[0]
    assert c["id"] == "windy-1234567890"
    assert c["place"] == "Nashville, Tennessee, United States"
    assert c["player"].endswith("/day") and c["page"].endswith("1234567890")
    assert c["live"].endswith("/live")


async def test_live_near_caches_and_maps_quota():
    calls = []

    def handler(request):
        calls.append(dict(request.url.params))
        if request.url.params.get("location", "").startswith("10."):
            return httpx.Response(403, text='{"error": "quotaExceeded"}')
        return httpx.Response(200, json=YT)

    v = video.Video("test")
    v.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(video.NoKey):
        await v.live_near(None, 36.1, -86.8, 100)
    out = await v.live_near("k", 36.1, -86.8, 100)
    assert out[0]["id"] == "abcdefghijk"
    assert calls[0]["eventType"] == "live" and calls[0]["type"] == "video"
    assert calls[0]["locationRadius"] == "100km"
    await v.live_near("k", 36.12, -86.79, 100)  # same rounded area
    assert len(calls) == 1
    with pytest.raises(video.Quota):
        await v.live_near("k", 10.0, 10.0, 100)
    await v.close()


async def test_event_video_falls_back_to_words():
    calls = []

    def handler(request):
        calls.append(dict(request.url.params))
        if "location" in request.url.params:
            return httpx.Response(200, json={"items": []})
        return httpx.Response(200, json=YT)

    v = video.Video("test")
    v.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    out = await v.about_event(
        "k", "E1", "Kharkiv attack", datetime(2026, 11, 19, tzinfo=UTC), 50, 36
    )
    assert len(out) == 1 and len(calls) == 2
    assert calls[0]["publishedAfter"] == "2026-11-18T18:00:00Z"
    assert calls[1]["q"] == "Kharkiv attack" and "location" not in calls[1]
    await v.close()


async def test_api_without_keys(app, admin_client):
    r = (
        await admin_client.get(
            "/api/video/near", params={"lat": 36.1, "lon": -86.8}
        )
    ).json()
    assert r == {"status": "nokey", "items": []}
    r = (
        await admin_client.get(
            "/api/webcams", params={"bbox": "-87,36,-86.5,36.4"}
        )
    ).json()
    assert r["status"] == "nokey"
    wide = await admin_client.get(
        "/api/webcams", params={"bbox": "-100,30,-80,40"}
    )
    assert wide.json()["status"] == "zoom"


async def test_webcams_api_proxies_images(app, admin_client):
    from argus import secrets
    from argus.models import ServerSetting

    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="keys",
                value={
                    "windy": secrets.encrypt(
                        app.state.settings.secret_key, "windy-key"
                    )
                },
            )
        )
        await db.commit()

    def handler(request):
        if request.url.host == "api.windy.com":
            assert request.headers["x-windy-api-key"] == "windy-key"
            return httpx.Response(200, json=WINDY)
        return httpx.Response(
            200, content=b"jpg", headers={"content-type": "image/jpeg"}
        )

    app.state.video.client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    app.state.video.cache.clear()
    r = (
        await admin_client.get(
            "/api/webcams", params={"bbox": "-87,36,-86.5,36.4"}
        )
    ).json()
    assert r["status"] == "ok" and "windy.com" in r["attribution"]
    cam = r["items"][0]
    assert cam["image"] == "/api/webcams/windy-1234567890/image"
    img = await admin_client.get(cam["image"])
    assert img.status_code == 200 and img.content == b"jpg"
