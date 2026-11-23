import httpx

from tests.conftest import csrf


async def test_identify_reaches_only_that_screen(app, admin_client):
    h = csrf(admin_client)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as screen:
        start = (await screen.post("/api/display/pair/start")).json()
        r = await admin_client.post(
            "/api/admin/displays",
            json={"code": start["code"], "name": "Office Display"},
            headers=h,
        )
        assert r.status_code in (200, 201), r.text
        sid = r.json()["id"]
        poll = await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )
        assert poll.json()["status"] == "paired"
        assert "identify" not in (await screen.get("/api/display/sync")).json()
        r = await admin_client.post(
            "/api/admin/displays/{0}/identify".format(sid), headers=h
        )
        assert r.status_code == 200
        got = (await screen.get("/api/display/sync")).json()["identify"]
        assert got["name"] == "Office Display" and got["seconds"] > 0
        # Other screens (and people) aren't told.
        assert (
            "identify"
            not in (await admin_client.get("/api/display/sync")).json()
        )
