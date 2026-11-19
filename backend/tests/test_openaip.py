import httpx

from argus import openaip, secrets
from argus.models import ServerSetting

RAW = {
    "_id": "abc123",
    "name": "R-4001 ABERDEEN",
    "type": 1,
    "icaoClass": 8,
    "country": "US",
    "lowerLimit": {"value": 0, "unit": 1, "referenceDatum": 0},
    "upperLimit": {"value": 250, "unit": 6, "referenceDatum": 2},
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [[-76.2, 39.4], [-76.0, 39.4], [-76.0, 39.6], [-76.2, 39.4]]
        ],
    },
}


def test_normalise_and_limits():
    item = openaip.normalise(RAW)
    assert (
        item["hazard"] == "Restricted" and item["area"] == "Class Unclassified"
    )
    assert item["lower"] == "Surface" and item["upper"] == "FL250"
    assert item["key"] == "openaip:abc123"
    assert openaip.normalise(dict(RAW, type=10)) is None  # FIRs are skipped
    assert openaip.limit_text(
        {"value": 1500, "unit": 1, "referenceDatum": 1}
    ) == ("1,500 ft MSL")


def test_tiles():
    assert openaip.tiles((-77, 38, -75, 40)) == [
        (-39, 19),
        (-39, 20),
        (-38, 19),
        (-38, 20),
    ]
    assert openaip.tiles((-180, -80, 180, 80)) is None


async def test_structure_api(admin_client, app):
    r = (
        await admin_client.get("/api/airspace/structure?bbox=-77,38,-75,40")
    ).json()
    assert r["status"] == "nokey"
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="keys",
                value={
                    "openaip": secrets.encrypt(
                        app.state.settings.secret_key, "K"
                    )
                },
            )
        )
        await db.commit()
    calls = []

    def handler(request):
        calls.append(
            (request.headers["x-openaip-api-key"], request.url.params["bbox"])
        )
        return httpx.Response(200, json={"items": [RAW], "totalPages": 1})

    app.state.openaip.client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    r = (
        await admin_client.get("/api/airspace/structure?bbox=-77,38,-75,40")
    ).json()
    assert r["status"] == "ok"
    assert [i["key"] for i in r["items"]] == ["openaip:abc123"]
    assert calls[0][0] == "K" and len(calls) == 4
    # Cached: the same view makes no new requests.
    await admin_client.get("/api/airspace/structure?bbox=-77,38,-75,40")
    assert len(calls) == 4
    wide = (
        await admin_client.get("/api/airspace/structure?bbox=-120,20,-60,50")
    ).json()
    assert wide["status"] == "zoom"


async def test_cloudflare_block_is_reported():
    import httpx
    import pytest

    from argus.openaip import Blocked, OpenAip

    def handler(request):
        return httpx.Response(
            403,
            text='<title>403</title><a href="/cdn-cgi/content?id=x">',
        )

    client = OpenAip("test")
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(Blocked):
        await client.tile("key", (0, 0))
    await client.close()
