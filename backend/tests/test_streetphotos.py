import httpx

from argus import streetphotos

IMAGE = {
    "id": "498763468214164",
    "computed_geometry": {"type": "Point", "coordinates": [-86.7801, 36.1601]},
    "compass_angle": 208.4,
    "captured_at": 1717000000000,
    "creator": {"username": "roadwalker", "id": "1"},
    "thumb_256_url": "https://scontent.example/t256.jpg",
    "thumb_1024_url": "https://scontent.example/t1024.jpg",
}


def test_parse_search_nearest_first():
    far = IMAGE | {
        "id": "far",
        "computed_geometry": {"coordinates": [-86.778, 36.1615]},
    }
    hidden = IMAGE | {"id": "x", "thumb_1024_url": None}
    out = streetphotos.parse_search(
        {"data": [far, IMAGE, hidden]}, 36.16, -86.78
    )
    assert [p["id"] for p in out] == ["498763468214164", "far"]
    first = out[0]
    assert first["heading"] == 208 and first["author"] == "roadwalker"
    assert first["taken"].startswith("2024-05-29")
    assert first["licence"] == "CC BY-SA 4.0"
    assert first["link"].startswith("https://www.mapillary.com/app/?pKey=")


async def test_without_a_token_only_street_view():
    sp = streetphotos.StreetPhotos("test")
    r = await sp.near(36.16, -86.78, None)
    assert r["status"] == "nokey" and r["photos"] == []
    assert r["street_view"] == (
        "https://www.google.com/maps/@?api=1&map_action=pano"
        "&viewpoint=36.160000,-86.780000"
    )
    await sp.close()


async def test_proxy_only_fetches_searched_images():
    seen = {}

    def handler(request):
        if request.url.host == "graph.mapillary.com":
            seen["token"] = request.url.params.get("access_token")
            return httpx.Response(200, json={"data": [IMAGE]})
        return httpx.Response(
            200, content=b"\xff\xd8jpg", headers={"content-type": "image/jpeg"}
        )

    sp = streetphotos.StreetPhotos("test")
    sp.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    url = "https://scontent.example/t1024.jpg"
    assert await sp.image(url) is None
    r = await sp.near(36.16, -86.78, "MLY|tok")
    assert seen["token"] == "MLY|tok"
    assert r["status"] == "ok" and "street_view" in r
    assert r["photos"][0]["image"].startswith("/api/streetphotos/image?u=")
    assert (await sp.image(url))[0] == b"\xff\xd8jpg"
    assert await sp.image("https://elsewhere.example/a.jpg") is None
    await sp.close()


async def test_refused_token():
    def handler(request):
        return httpx.Response(401, json={"error": "bad token"})

    sp = streetphotos.StreetPhotos("test")
    sp.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    r = await sp.near(36.16, -86.78, "MLY|bad")
    assert r["status"] == "refused" and r["street_view"]
    await sp.close()
