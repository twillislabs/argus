import httpx

from argus import space
from argus.models import Satellite
from argus.search import decode

ISS = {
    "OBJECT_NAME": "ISS (ZARYA)",
    "OBJECT_ID": "1998-067A",
    "EPOCH": "2026-11-18T07:14:53.624256",
    "MEAN_MOTION": 15.49454822,
    "ECCENTRICITY": 0.00073878,
    "INCLINATION": 51.6316,
    "RA_OF_ASC_NODE": 257.4339,
    "ARG_OF_PERICENTER": 38.9132,
    "MEAN_ANOMALY": 321.2387,
    "EPHEMERIS_TYPE": 0,
    "CLASSIFICATION_TYPE": "U",
    "NORAD_CAT_ID": 25544,
    "ELEMENT_SET_NO": 999,
    "REV_AT_EPOCH": 59564,
    "BSTAR": 0.00023055374,
    "MEAN_MOTION_DOT": 0.00012483,
    "MEAN_MOTION_DDOT": 0,
}


def sat(norad, name="SAT {0}", mm=15.0, ecc=0.001, epoch=ISS["EPOCH"]):
    return dict(
        ISS,
        NORAD_CAT_ID=norad,
        OBJECT_NAME=name.format(norad),
        OBJECT_ID="2020-{0:03d}A".format(norad % 1000),
        MEAN_MOTION=mm,
        ECCENTRICITY=ecc,
        EPOCH=epoch,
    )


def test_orbit_class_and_numbers():
    assert space.orbit_class(15.5, 0.0007) == "leo"
    assert space.orbit_class(2.0, 0.01) == "meo"
    assert space.orbit_class(1.0027, 0.0002) == "geo"
    assert space.orbit_class(2.006, 0.72) == "heo"
    n = space.orbit_numbers(ISS)
    assert 92 < n["period_min"] < 93
    assert 390 < n["perigee_km"] < 440 and 390 < n["apogee_km"] < 440
    assert space.name_tags("STARLINK-1234") == ["starlink"]


async def test_refresh_catalog_tags_and_replaces(app):
    main = (
        [ISS]
        + [sat(i) for i in range(1, 1100)]
        + [sat(50000, "STARLINK-5000")]
    )

    def handler(request):
        group = request.url.params["GROUP"]
        if group == "active":
            return httpx.Response(200, json=main)
        if group == "stations":
            return httpx.Response(200, json=[ISS])
        if group == "weather":
            return httpx.Response(403, text="blocked")
        return httpx.Response(200, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    async with app.state.db.sessionmaker() as db:
        count, failures = await space.refresh_catalog(db, client)
        await db.commit()
        assert count == len(main)
        assert failures == ["weather"]
        iss = await db.get(Satellite, 25544)
        assert iss.orbit_class == "leo" and iss.tags == ["station"]
        assert (await db.get(Satellite, 50000)).tags == ["starlink"]
        # A second refresh replaces everything.
        main[:] = [ISS] + [sat(i) for i in range(1, 1001)]
        await space.refresh_catalog(db, client)
        await db.commit()
        assert await db.get(Satellite, 50000) is None
    await client.aclose()


async def test_refresh_refuses_a_tiny_catalogue(app):
    def handler(request):
        return httpx.Response(200, json=[ISS])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    async with app.state.db.sessionmaker() as db:
        try:
            await space.refresh_catalog(db, client)
        except ValueError as exc:
            assert "only 1" in str(exc)
        else:
            raise AssertionError("expected ValueError")
    await client.aclose()


async def seed(app):
    async with app.state.db.sessionmaker() as db:
        for record in (ISS, sat(43013, "NOAA 20 (JPSS-1)", mm=14.19)):
            db.add(
                Satellite(
                    norad_id=record["NORAD_CAT_ID"],
                    name=record["OBJECT_NAME"],
                    object_id=record["OBJECT_ID"],
                    orbit_class="leo",
                    tags=["station"] if record is ISS else ["weather"],
                    epoch=space._epoch(record["EPOCH"]),
                    omm=record,
                )
            )
        await db.commit()


async def test_satellite_api(admin_client, app):
    assert (await admin_client.get("/api/satellites/25544")).status_code == 404
    await seed(app)
    r = await admin_client.get("/api/satellites")
    body = r.json()
    assert body["fields"][0] == "norad"
    first = body["satellites"][0]
    assert first[0] == 25544 and first[1] == "ISS (ZARYA)"
    assert first[6] == ISS["MEAN_MOTION"]
    again = await admin_client.get(
        "/api/satellites", headers={"If-None-Match": r.headers["etag"]}
    )
    assert again.status_code == 304
    detail = (await admin_client.get("/api/satellites/25544")).json()
    assert detail["orbit"]["inclination"] == 51.63
    assert detail["omm"]["OBJECT_ID"] == "1998-067A"


async def test_satellite_search(admin_client, app):
    assert ("norad", 25544) in [(r.kind, r.value) for r in decode("25544")]
    assert ("cospar", "1998-067A") in [
        (r.kind, r.value) for r in decode("1998-067a")
    ]
    await seed(app)

    async def results(q):
        r = await admin_client.get("/api/search", params={"q": q})
        return r.json()["results"]

    assert (await results("25544"))[0]["norad"] == 25544
    assert (await results("1998-067A"))[0]["label"] == "ISS (ZARYA)"
    first = (await results("ISS"))[0]
    assert first["kind"] == "satellite" and first["norad"] == 25544
    hits = await results("noaa 20")
    assert any(h.get("norad") == 43013 for h in hits)
