import httpx

from argus import streetphotos

FEATURE = {
    "id": "5914cdbb",
    "geometry": {"coordinates": [2.3501, 48.8549]},
    "properties": {
        "view:azimuth": 208,
        "datetimetz": "2025-05-05T08:34:27+02:00",
        "geovisio:producer": "Britzz",
        "license": "CC-BY-SA-4.0",
        "geovisio:status": "ready",
    },
    "assets": {
        "thumb": {"href": "https://pano.example/thumb.jpg"},
        "sd": {"href": "https://pano.example/sd.jpg"},
    },
    "links": [
        {
            "rel": "license",
            "href": "https://creativecommons.org/licenses/by-sa/4.0/",
        }
    ],
}


def test_parse_search_nearest_first():
    far = FEATURE | {
        "id": "far",
        "geometry": {"coordinates": [2.352, 48.856]},
    }
    hidden = FEATURE | {"id": "x", "assets": {}}
    out = streetphotos.parse_search(
        {"features": [far, FEATURE, hidden]}, 48.855, 2.35
    )
    assert [p["id"] for p in out] == ["5914cdbb", "far"]
    assert out[0]["heading"] == 208 and out[0]["author"] == "Britzz"
    assert out[0]["link"].endswith("pic=5914cdbb")


async def test_proxy_only_fetches_searched_images():
    def handler(request):
        if request.url.path == "/api/search":
            return httpx.Response(200, json={"features": [FEATURE]})
        return httpx.Response(
            200, content=b"\xff\xd8jpg", headers={"content-type": "image/jpeg"}
        )

    sp = streetphotos.StreetPhotos("test")
    sp.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert await sp.image("https://pano.example/sd.jpg") is None
    r = await sp.near(48.855, 2.35)
    assert r["photos"][0]["image"].startswith("/api/streetphotos/image?u=")
    assert (await sp.image("https://pano.example/sd.jpg"))[0] == b"\xff\xd8jpg"
    assert await sp.image("https://elsewhere.example/a.jpg") is None
