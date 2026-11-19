from tests.conftest import csrf


async def test_pair_a_screen(app, admin_client):
    import httpx

    # The screen: a separate browser with no session.
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as screen:
        start = (await screen.post("/api/display/pair/start")).json()
        assert len(start["code"]) == 6
        waiting = await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )
        assert waiting.json() == {"status": "waiting"}

        # The admin enters the code.
        bad = await admin_client.post(
            "/api/admin/displays",
            json={"code": "ZZZZZZ", "name": "Ops TV"},
            headers=csrf(admin_client),
        )
        assert bad.status_code == 404
        ok = await admin_client.post(
            "/api/admin/displays",
            json={"code": start["code"].lower(), "name": "Ops TV"},
            headers=csrf(admin_client),
        )
        assert ok.status_code == 200, ok.text
        display_id = ok.json()["id"]

        paired = await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )
        assert paired.json()["status"] == "paired"
        me = (await screen.get("/api/me")).json()
        assert me["user"]["role"] == "display"
        assert me["user"]["display_name"] == "Ops TV"
        # The code can't be used twice.
        again = await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )
        assert again.status_code == 410

        listed = (await admin_client.get("/api/admin/displays")).json()
        assert listed["displays"][0]["name"] == "Ops TV"

        # Unpairing ends the screen's session.
        gone = await admin_client.delete(
            "/api/admin/displays/{0}".format(display_id),
            headers=csrf(admin_client),
        )
        assert gone.status_code == 200
        assert (await screen.get("/api/me")).status_code == 401


async def test_only_admins_approve(client):
    r = await client.post(
        "/api/admin/displays", json={"code": "ABCDEF", "name": "x"}
    )
    assert r.status_code in (401, 403)
