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


def test_parse_txdot():
    row = {
        "statusDescription": "Device Online",
        "hasSnapshot": True,
        "icd_Id": "FM-734 @ US-290 EB",
        "name": "FM-734 @ US-290 EB",
        "latitude": 30.34396,
        "longitude": -97.57988,
        "equipLoc": {"roadway": "FM-734", "direction": "North"},
    }
    doc = {
        "roadwayCctvStatuses": {
            "FM-734": [
                row,
                dict(row),  # an interchange listed under both roads
                dict(row, icd_Id="off", statusDescription="Device Offline"),
                dict(row, icd_Id="nopic", hasSnapshot=False),
                dict(row, icd_Id="noloc", latitude=None),
            ]
        }
    }
    tx = cams.parse_txdot(doc, "AUS")
    assert [c["id"] for c in tx] == ["txdot-aus-FM-734-US-290-EB"]
    assert tx[0]["direction"] == 90.0  # "EB", not the road's "North"
    assert tx[0]["image_json"] == "snippet"
    assert tx[0]["image"].startswith(cams.TXDOT_IMAGE + "?icdId=FM-734")
    assert "districtCode=AUS" in tx[0]["image"]


def test_parse_wsdot():
    x, y = -13656007.1, 5719738.5
    feats = [
        {
            "attributes": {
                "CameraID": 1003,
                "CompassDirection": "N",
                "CameraTitle": "I-5 at MP 3.2: Main St",
                "ImageURL": "https://images.wsdot.wa.gov/sw/005vc00320.jpg",
            },
            "geometry": {"x": x, "y": y},
        },
        {
            "attributes": {
                "CameraID": 1004,
                "CompassDirection": "B",
                "CameraTitle": "Both ways",
                "ImageURL": "https://images.wsdot.wa.gov/sw/b.jpg",
            },
            "geometry": {"x": x, "y": y},
        },
        {  # a partner camera, under its own terms
            "attributes": {
                "CameraID": 1001,
                "ImageURL": "https://www.tripcheck.com/RoadCams/a.jpg",
            },
            "geometry": {"x": x, "y": y},
        },
    ]
    wa = cams.parse_wsdot({"features": feats})
    assert [c["id"] for c in wa] == ["wsdot-1003", "wsdot-1004"]
    assert abs(wa[0]["lat"] - 45.6146) < 0.01
    assert abs(wa[0]["lon"] + 122.675) < 0.01
    assert wa[0]["direction"] == 0.0 and wa[1]["direction"] is None


def test_parse_hktd():
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<image-list>
  <image><key>H429F</key><region>Hong Kong Island</region>
    <district>Southern</district>
    <description>Aberdeen Praya Road [H429F]</description>
    <latitude>22.24845</latitude><longitude>114.1505</longitude>
    <url>https://elsewhere.example/x.jpg</url></image>
  <image><key>H429F</key><latitude>22.2</latitude>
    <longitude>114.1</longitude></image>
  <image><key>../bad</key><latitude>22.2</latitude>
    <longitude>114.1</longitude></image>
</image-list>"""
    hk = cams.parse_hktd(xml)
    assert [c["id"] for c in hk] == ["hktd-h429f"]
    # Built from the key, never taken from the feed.
    assert hk[0]["image"] == "https://tdcctv.data.one.gov.hk/H429F.JPG"
    assert hk[0]["place"] == "Southern · Hong Kong Island"


async def test_image_proxy_decodes_json_images(app, admin_client):
    import base64

    from argus.models import ServerSetting

    cam = cams.parse_txdot(
        {
            "roadwayCctvStatuses": {
                "I-35": [
                    {
                        "statusDescription": "Device Online",
                        "icd_Id": "I-35 @ 6th",
                        "name": "I-35 @ 6th",
                        "latitude": 30.27,
                        "longitude": -97.73,
                    }
                ]
            }
        },
        "AUS",
    )
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:trafficcams",
                value={"feeds": {"txdot": cam}},
            )
        )
        await db.commit()
    app.state.cams_catalogue = None
    jpeg = b"\xff\xd8\xff\xe0jpeg"
    answers = {
        "good": {"snippet": base64.b64encode(jpeg).decode()},
        "bad": {"snippet": base64.b64encode(b"<html>").decode()},
    }
    which = ["good"]

    def handler(request):
        assert request.url.host == "its.txdot.gov"
        return httpx.Response(200, json=answers[which[0]])

    app.state.cams_http = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    app.state.cams_images = {}
    url = "/api/cams/{0}/image".format(cam[0]["id"])
    img = await admin_client.get(url)
    assert img.status_code == 200 and img.content == jpeg
    assert img.headers["content-type"] == "image/jpeg"
    which[0] = "bad"
    app.state.cams_images = {}
    assert (await admin_client.get(url)).status_code == 502


async def test_new_feeds_fetch_once(app):
    from datetime import UTC, datetime

    from argus import worker
    from argus.models import ServerSetting

    # Yesterday's pass knew only Caltrans: the others are new.
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:trafficcams",
                value={
                    "fetched": datetime.now(UTC).isoformat(),
                    "feeds": {"caltrans": cams.parse_caltrans(CALTRANS, 7)},
                },
            )
        )
        await db.commit()
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        return httpx.Response(503)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await worker.cams_pass(app.state.db, app.state.settings, client)
    assert "data.wsdot.wa.gov" in hosts and "its.txdot.gov" in hosts
    async with app.state.db.sessionmaker() as db:
        value = (await db.get(ServerSetting, "layer:trafficcams")).value
    # Failed feeds keep the old cameras; each was tried.
    assert len(value["feeds"]["caltrans"]) == 1
    assert "hktd" in value["tried"]
    hosts.clear()
    await worker.cams_pass(app.state.db, app.state.settings, client)
    assert hosts == []  # not again until tomorrow
    async with app.state.db.sessionmaker() as db:
        source = await db.get(worker.Source, "trafficcams")
    assert len(source.label) <= 80


def test_more_open_feeds():
    austin = cams.parse_austin(
        {
            "meta": {
                "view": {
                    "columns": [
                        {"fieldName": "camera_id"},
                        {"fieldName": "location_name"},
                        {"fieldName": "camera_status"},
                        {"fieldName": "location"},
                    ]
                }
            },
            "data": [
                [
                    "1",
                    "830 BLK W RUNDBERG LN",
                    "TURNED_ON",
                    "POINT (-97.7 30.36)",
                ],
                ["2", "Planned", "DESIRED", "POINT (-97.7 30.36)"],
            ],
        }
    )
    assert [c["id"] for c in austin] == ["austin-1"]
    assert austin[0]["image"] == "https://cctv.austinmobility.io/image/1.jpg"
    assert (austin[0]["lat"], austin[0]["lon"]) == (30.36, -97.7)

    def king_row(asset, owner="King County", **extra):
        props = {
            "AssetID": asset,
            "Location": "Avondale Rd NE",
            "ImageURL": "http://info.kingcounty.gov/x/Handler.ashx?id=a.jpg",
            "Live": 1,
            "Owner": owner,
            "CurrentStatus": "Active",
        } | extra
        return {
            "geometry": {"coordinates": [-122.08, 47.75]},
            "properties": props,
        }

    king = cams.parse_king(
        {
            "features": [
                king_row(224),
                king_row(225, owner="WSDOT"),  # WSDOT's feed has it
                king_row(226, Live=0),
                king_row(227, owner="Newcastle"),
            ]
        }
    )
    assert [c["id"] for c in king] == ["king-224", "king-227"]
    assert king[0]["image"].startswith("https://info.kingcounty.gov/")
    assert king[1]["agency"] == "Newcastle (King County)"

    toronto = cams.parse_toronto(
        'jsonTMCEarthCamerasCallback({"Data":[{"Number":"8001",'
        '"Name":"YORK ST","Latitude":"43.64","Longitude":"-79.38",'
        '"D1":"n"},{"Number":"../x","Latitude":"1","Longitude":"1"}]});'
    )
    assert [c["id"] for c in toronto] == ["toronto-8001"]
    assert toronto[0]["image"].endswith("/CameraImages/loc8001.jpg")
    assert toronto[0]["direction"] is None  # D1-D4 aren't a facing

    calgary = cams.parse_calgary(
        [
            {
                "camera_url": {"url": "http://trafficcam.calgary.ca/loc0.jpg"},
                "camera_location": "Glenmore Trail / Macleod Trail S",
                "point": {"coordinates": [-114.07, 50.99]},
            },
            {
                "camera_url": {"url": "https://elsewhere.example/loc1.jpg"},
                "point": {"coordinates": [-114.07, 50.99]},
            },
        ]
    )
    assert [c["id"] for c in calgary] == ["calgary-0"]
    assert calgary[0]["image"] == "https://trafficcam.calgary.ca/loc0.jpg"

    def veg(cid, **extra):
        return {
            "geometry": {"coordinates": [5.46, 61.83]},
            "properties": {
                "cameraId": cid,
                "stillImageUrl": cams.VEGVESEN_IMAGES + cid,
                "description": "Langesi",
                "orientationDescription": "Svelgen",
                "roadNumber": "F614",
            }
            | extra,
        }

    norway = cams.parse_vegvesen(
        {
            "features": [
                veg("3000063_1"),
                veg(
                    "1429037_1",
                    videoEncodingStandard="hls",
                    videoUrl=cams.VEGVESEN_VIDEO + "1429037_1/manifest.m3u8",
                ),
                veg("bad", stillImageUrl="https://elsewhere.example/x"),
            ]
        }
    )
    assert [c["id"] for c in norway] == [
        "vegvesen-3000063_1",
        "vegvesen-1429037_1",
    ]
    assert norway[0]["stream"] is None and norway[1]["stream"]
    assert norway[0]["place"] == "Norway · towards Svelgen"

    iceland = cams.parse_iceland(
        [
            {
                "Skyring": "Hellisheiði séð til vesturs",
                "Slod": cams.ICELAND_IMAGES + "hellisheidi_1.jpg",
                "Breidd": 64.0183,
                "Lengd": -21.3426,
            },
            {
                "Skyring": "Hellisheiði séð niður á veg",
                "Slod": cams.ICELAND_IMAGES + "hellisheidi_2.jpg",
                "Breidd": 64.0183,
                "Lengd": -21.3426,
            },
        ]
    )
    assert [c["direction"] for c in iceland] == [270.0, None]
    assert iceland[1]["lat"] > iceland[0]["lat"]  # spread apart

    deldot = cams.parse_deldot(
        {
            "videoCameras": [
                {
                    "id": "KCAM001",
                    "title": "DE 1 @ MILFORD NECK RD",
                    "county": "Kent",
                    "lat": 38.99,
                    "lon": -75.45,
                    "status": "Active",
                    "urls": {
                        "m3u8s": "https://video.deldot.gov:443/live/"
                        "KCAM001.stream/playlist.m3u8"
                    },
                },
                {
                    "id": "KCAM002",
                    "lat": 38.99,
                    "lon": -75.45,
                    "status": "Active",
                    "urls": {"m3u8s": "https://elsewhere.example/a.m3u8"},
                },
            ]
        }
    )
    assert [c["id"] for c in deldot] == ["deldot-KCAM001"]
    assert deldot[0]["image"] is None
    assert deldot[0]["stream"] == (
        "https://video.deldot.gov/live/KCAM001.stream/playlist.m3u8"
    )


async def test_video_only_cameras_have_no_image(app, admin_client):
    from argus.models import ServerSetting

    cam = cams.parse_deldot(
        {
            "videoCameras": [
                {
                    "id": "KCAM001",
                    "lat": 38.99,
                    "lon": -75.45,
                    "status": "Active",
                    "urls": {
                        "m3u8s": "https://video.deldot.gov/live/"
                        "KCAM001.stream/playlist.m3u8"
                    },
                }
            ]
        }
    )
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:trafficcams", value={"feeds": {"deldot": cam}}
            )
        )
        await db.commit()
    app.state.cams_catalogue = None
    r = (
        await admin_client.get("/api/cams", params={"bbox": "-76,38,-75,40"})
    ).json()
    assert r["cameras"][0]["image"] is None
    assert r["cameras"][0]["video"] == "live"
    img = await admin_client.get("/api/cams/deldot-KCAM001/image")
    assert img.status_code == 404
