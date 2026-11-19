import httpx

from argus import cams

CALTRANS = {
    "data": [
        {
            "cctv": {
                "index": "1",
                "inService": "true",
                "location": {
                    "locationName": "I-110 : (196) Avenue 26 Off Ramp",
                    "nearbyPlace": "Cypress Park",
                    "latitude": "34.0837",
                    "longitude": "-118.2215",
                    "direction": "South",
                    "route": "I-110",
                },
                "imageData": {
                    "streamingVideoURL": "https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8",
                    "static": {
                        "currentImageUpdateFrequency": "2",
                        "currentImageURL": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/x/x.jpg",
                    },
                },
            }
        },
        {"cctv": {"index": "2", "inService": "false", "location": {}}},
        {
            "cctv": {
                "index": "3",
                "location": {"latitude": "", "longitude": ""},
                "imageData": {"static": {}},
            }
        },
    ]
}


def test_parse_caltrans():
    out = cams.parse_caltrans(CALTRANS, 7)
    assert len(out) == 1
    c = out[0]
    assert c["id"] == "caltrans-d7-1" and c["direction"] == 180.0
    assert c["road"] == "I-110" and c["place"] == "Cypress Park"
    assert c["stream"].endswith(".m3u8") and c["refresh_s"] == 120


def test_parse_tdot_guesses_field_names():
    out = cams.parse_tdot(
        [
            {
                "id": 12,
                "title": "I-40 at Charlotte Ave",
                "lat": 36.16,
                "lng": -86.8,
                "thumbnailUrl": "https://smartway.example/img/12.jpg",
                "route": "I-40",
                "direction": "EB",
            },
            {"id": 13, "title": "no position"},
        ]
    )
    assert [c["id"] for c in out] == ["tdot-12"]
    assert out[0]["direction"] == 90.0 and out[0]["agency"] == "TDOT SmartWay"


def test_bearing_and_image_check():
    assert cams.bearing("Northbound") == 0.0
    assert cams.bearing("W") == 270.0
    assert cams.bearing(400) == 40.0
    assert cams.bearing("") is None
    assert cams.image_allowed("https://cwwp2.dot.ca.gov/a.jpg")
    assert not cams.image_allowed("http://cwwp2.dot.ca.gov/a.jpg")
    assert not cams.image_allowed("https://127.0.0.1/a.jpg")
    assert not cams.image_allowed("https://localhost/a.jpg")


async def test_cams_api_and_image_proxy(app, admin_client):
    from argus.models import ServerSetting

    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:trafficcams",
                value={
                    "fetched": "2026-11-19T00:00:00+00:00",
                    "feeds": {"caltrans": cams.parse_caltrans(CALTRANS, 7)},
                },
            )
        )
        await db.commit()
    wide = await admin_client.get(
        "/api/cams", params={"bbox": "-125,30,-110,42"}
    )
    assert wide.json()["status"] == "zoom"
    r = (
        await admin_client.get(
            "/api/cams", params={"bbox": "-119,33.5,-117.5,35"}
        )
    ).json()
    assert r["status"] == "ok" and len(r["cameras"]) == 1
    cam = r["cameras"][0]
    assert cam["image"] == "/api/cams/caltrans-d7-1/image" and cam["video"]
    assert "cwwp2" not in str(cam)  # agency URLs stay on the server

    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(
            200,
            content=b"\xff\xd8jpeg",
            headers={"content-type": "image/jpeg"},
        )

    app.state.cams_http = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    app.state.cams_images = {}
    img = await admin_client.get(cam["image"])
    assert img.status_code == 200 and img.content == b"\xff\xd8jpeg"
    await admin_client.get(cam["image"])
    assert len(calls) == 1  # cached
    assert (await admin_client.get("/api/cams/nope/image")).status_code == 404
