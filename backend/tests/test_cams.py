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
    assert cam["image"] == "/api/cams/caltrans-d7-1/image"
    assert cam["video"] == "live"
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
    v = (await admin_client.get("/api/cams/caltrans-d7-1/video")).json()
    assert v == {
        "kind": "live",
        "url": "https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8",
    }


def test_open_feeds():
    bc = cams.parse_drivebc(
        [
            {
                "id": 591,
                "name": "Fort St. John - SE",
                "caption": "Highway 97 at 100 Avenue, looking southeast.",
                "highway_display": "97",
                "location": {"type": "Point", "coordinates": [-120.87, 56.25]},
                "orientation": "SE",
                "is_on": True,
                "should_appear": True,
            },
            {"id": 592, "is_on": False, "location": {"coordinates": [1, 2]}},
        ]
    )
    assert [c["id"] for c in bc] == ["drivebc-591"]
    assert bc[0]["direction"] == 135.0
    assert bc[0]["image"] == "https://www.drivebc.ca/images/591.jpg"

    tfl = cams.parse_tfl(
        [
            {
                "id": "JamCams_00002.00865",
                "commonName": "A406 Billet Upass E",
                "lat": 51.6,
                "lon": -0.02,
                "additionalProperties": [
                    {"key": "available", "value": "true"},
                    {"key": "imageUrl", "value": "https://s3.example/a.jpg"},
                    {"key": "videoUrl", "value": "https://s3.example/a.mp4"},
                    {"key": "view", "value": "East"},
                ],
            },
            {
                "id": "JamCams_off",
                "lat": 51,
                "lon": 0,
                "additionalProperties": [
                    {"key": "available", "value": "false"}
                ],
            },
        ]
    )
    assert [c["id"] for c in tfl] == ["tfl-00002.00865"]
    assert tfl[0]["clip"].endswith(".mp4") and tfl[0]["stream"] is None

    fi = cams.parse_digitraffic(
        {
            "features": [
                {
                    "geometry": {"coordinates": [23.99, 60.05, 0]},
                    "properties": {
                        "name": "kt51_Inkoo",
                        "collectionStatus": "GATHERING",
                        "presets": [
                            {"id": "C0150301", "inCollection": True},
                            {"id": "C0150302", "inCollection": True},
                            {"id": "C0150303", "inCollection": False},
                        ],
                    },
                }
            ]
        }
    )
    assert [c["id"] for c in fi] == [
        "digitraffic-C0150301",
        "digitraffic-C0150302",
    ]
    assert fi[0]["image"] == "https://weathercam.digitraffic.fi/C0150301.jpg"
    assert fi[1]["name"] == "kt51 Inkoo (2)"


async def test_image_proxy_follows_safe_redirects_only():
    from argus.api import cams as cams_api

    def handler(request):
        if request.url.path == "/thumbs/a.png":
            return httpx.Response(
                301, headers={"location": "https://snap.example.org/a.png"}
            )
        if request.url.path == "/thumbs/bad.png":
            return httpx.Response(
                302, headers={"location": "https://127.0.0.1/secret"}
            )
        return httpx.Response(
            200, content=b"png", headers={"content-type": "image/png"}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    ) as client:
        r = await cams_api.fetch_image(
            client, "https://snap.example.org/thumbs/a.png"
        )
        assert r.status_code == 200 and r.content == b"png"
        try:
            await cams_api.fetch_image(
                client, "https://snap.example.org/thumbs/bad.png"
            )
            raise AssertionError("followed a redirect to an address")
        except httpx.HTTPError:
            pass
