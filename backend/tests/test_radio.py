import httpx

from argus import radio

STATION = {
    "stationuuid": "a1",
    "name": "Radio One",
    "url_resolved": "https://stream.example/live.aac",
    "homepage": "https://radio.example/",
    "country": "Finland",
    "language": "finnish",
    "tags": "news,talk",
    "codec": "AAC",
    "bitrate": 128,
    "geo_lat": 60.17,
    "geo_long": 24.94,
    "hls": 0,
}


def test_parse_stations():
    out = radio.parse_stations(
        [
            STATION,
            STATION,  # listed twice
            STATION | {"stationuuid": "b", "url_resolved": "http://x/a.mp3"},
            STATION | {"stationuuid": "c", "geo_lat": 0, "geo_long": 0},
        ]
    )
    assert [s["id"] for s in out] == ["a1"]
    assert out[0]["tags"] == ["news", "talk"]
    assert out[0]["stream"].startswith("https://")


async def test_falls_back_to_the_next_server():
    asked = []

    def handler(request):
        asked.append(request.url.host)
        if request.url.host.startswith("de1."):
            return httpx.Response(503)
        return httpx.Response(200, json=[STATION])

    r = radio.Radio("test")
    r.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    got = await r.stations()
    assert got["status"] == "ok" and len(got["stations"]) == 1
    assert asked == [
        "de1.api.radio-browser.info",
        "de2.api.radio-browser.info",
    ]
    await r.stations()
    assert len(asked) == 2  # kept for the day
