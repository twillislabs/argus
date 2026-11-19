import httpx
import pytest

from argus import imagery

FEATURES = [
    {
        "properties": {
            "datetime": "2026-11-12T16:35:29Z",
            "platform": "Sentinel-2B",
            "eo:cloud_cover": 40.0,
        }
    },
    {
        "properties": {
            "datetime": "2026-11-12T16:35:31Z",
            "platform": "Sentinel-2B",
            "eo:cloud_cover": 10.0,
        }
    },
    {
        "properties": {
            "datetime": "2026-11-09T16:25:00Z",
            "platform": "Sentinel-2C",
            "eo:cloud_cover": 2.5,
        }
    },
    {"properties": {"datetime": "garbage"}},
]


def test_group_passes():
    passes = imagery.group_passes(FEATURES, cloud=True)
    assert [p["date"] for p in passes] == ["2026-11-12", "2026-11-09"]
    assert passes[0]["cloud"] == 25.0 and passes[0]["scenes"] == 2
    assert passes[0]["platforms"] == ["Sentinel-2B"]
    radar = imagery.group_passes(FEATURES, cloud=False)
    assert radar[0]["cloud"] is None


def test_check_box():
    imagery.check_box((-86.9, 36.0, -86.6, 36.3))
    with pytest.raises(imagery.ImageryError):
        imagery.check_box((-90.0, 36.0, -86.0, 36.3))
    with pytest.raises(imagery.ImageryError):
        imagery.check_box((-86.6, 36.0, -86.9, 36.3))


async def test_tiles_cached_on_disk(tmp_path):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if "/tiles/WebMercatorQuad/12/1/1@" in str(request.url):
            return httpx.Response(404)
        return httpx.Response(
            200, content=b"PNG", headers={"content-type": "image/png"}
        )

    im = imagery.Imagery("test", str(tmp_path))
    im.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    sid = "pc1.123.abcdef"
    assert await im.tile("optical", sid, 12, 1060, 1612) == b"PNG"
    assert await im.tile("optical", sid, 12, 1060, 1612) == b"PNG"
    assert len(calls) == 1 and "assets=visual" in calls[0]
    assert "collection=sentinel-2-l2a" in calls[0]
    # No data there: remembered too, as an empty tile.
    assert await im.tile("optical", sid, 12, 1, 1) is None
    assert await im.tile("optical", sid, 12, 1, 1) is None
    assert len(calls) == 2
    with pytest.raises(imagery.ImageryError):
        await im.tile("optical", "../../etc", 12, 1, 1)
    with pytest.raises(imagery.ImageryError):
        await im.tile("optical", sid, 3, 1, 1)
    await im.close()


async def test_api_needs_sign_in(client):
    r = await client.get("/api/imagery/passes?bbox=-86.9,36,-86.6,36.3")
    assert r.status_code == 401


async def test_api_rejects_big_box(admin_client):
    r = await admin_client.get("/api/imagery/passes?bbox=-90,30,-80,40")
    assert r.status_code == 422
    r = await admin_client.get(
        "/api/imagery/passes?kind=infrared&bbox=-86.9,36,-86.6,36.3"
    )
    assert r.status_code == 422
