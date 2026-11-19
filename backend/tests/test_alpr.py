import httpx

from argus import alpr

ELEMENTS = [
    {
        "type": "node",
        "id": 101,
        "lat": 36.16,
        "lon": -86.78,
        "tags": {
            "man_made": "surveillance",
            "surveillance:type": "ALPR",
            "manufacturer": "Flock Safety",
            "operator": "Metro Nashville Police Department",
            "camera:direction": "NE",
            "check_date": "2026-05-01",
        },
    },
    {
        "type": "way",
        "id": 7,
        "center": {"lat": 36.5, "lon": -86.2},
        "tags": {"surveillance:type": "ALPR", "brand": "Vigilant"},
    },
    {"type": "node", "id": 9, "tags": {}},  # no position
]


def test_normalise_and_helpers():
    cams = [alpr.normalise(e) for e in ELEMENTS]
    assert cams[2] is None
    a, b = cams[0], cams[1]
    assert a["vendor"] == "Flock Safety" and a["direction"] == 45.0
    assert a["operator"].startswith("Metro Nashville")
    assert a["osm_url"].endswith("/node/101")
    assert b["vendor"] == "Motorola Solutions" and b["direction"] is None
    assert (b["lat"], b["lon"]) == (36.5, -86.2)
    assert alpr.direction({"direction": "270;90"}) == 270.0
    assert alpr.tiles((-90, 34, -84, 38)) == [
        (x, y) for x in (-45, -44, -43) for y in (17, 18)
    ]
    assert alpr.tiles((-130, 20, -60, 50)) is None


async def test_area_fetches_a_few_tiles_per_call_and_caches():
    calls = []

    def handler(request):
        calls.append(request.content)
        return httpx.Response(200, json={"elements": ELEMENTS})

    client = alpr.Alpr("test")
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    alpr.GAP_S = 0
    box = (-88, 34, -82, 38)  # 3 x 2 tiles
    cams, complete = await client.area(box)
    assert not complete and len(calls) == alpr.NEW_PER_CALL
    while not complete:
        cams, complete = await client.area(box)
    assert len(calls) == 6
    # Every tile returned the same two cameras; only those inside count.
    assert {c["id"] for c in cams} == {"node/101", "way/7"}
    await client.area(box)
    assert len(calls) == 6  # cached
    await client.close()


async def test_busy_overpass_is_not_retried_at_once():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(429)

    client = alpr.Alpr("test")
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    alpr.GAP_S = 0
    box = (-87, 36, -86.5, 36.5)
    assert await client.area(box) == ([], False)
    assert await client.area(box) == ([], False)
    assert len(calls) == 1
    await client.close()


async def test_alpr_api(app, admin_client):
    r = await admin_client.get("/api/alpr", params={"bbox": "-130,20,-60,50"})
    assert r.json()["status"] == "zoom"
