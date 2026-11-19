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

        # The admin sets what this screen shows; the screen sees it.
        url = "/api/admin/displays/{0}/wall".format(display_id)
        assert (await admin_client.get(url)).json() == {
            "wall": {},
            "home": None,
        }
        wall = {
            "stops": [
                {"kind": "theatre", "key": "europe"},
                {
                    "kind": "place",
                    "name": "Taiwan Strait",
                    "lat": 24.5,
                    "lon": 119.8,
                    "height": 900000,
                },
            ],
            "stop_s": 40,
            "interrupt": False,
            "layers": {"cables": False, "sigmet": True},
            "news": False,
            "zones": [{"label": "Kyiv", "tz": "Europe/Kyiv"}],
        }
        home = {"name": "Ops", "lat": 50.4, "lon": 30.5, "tz": "Europe/Kyiv"}
        put = await admin_client.put(
            url, json={"wall": wall, "home": home}, headers=csrf(admin_client)
        )
        assert put.status_code == 200, put.text
        me = (await screen.get("/api/me")).json()
        assert me["preferences"]["wall"]["stop_s"] == 40
        assert me["preferences"]["wall"]["stops"][1]["name"] == "Taiwan Strait"
        assert me["preferences"]["home"]["name"] == "Ops"
        for bad_wall in (
            {"layers": {"nope": True}},
            {"stops": [{"kind": "place", "lat": 1, "lon": 2}]},
            {"stops": [{"kind": "theatre"}]},
            {"stop_s": 2},
        ):
            r = await admin_client.put(
                url, json={"wall": bad_wall}, headers=csrf(admin_client)
            )
            assert r.status_code == 422, bad_wall
        # Only display accounts have wall settings here.
        me_id = (await admin_client.get("/api/me")).json()["user"]["id"]
        r = await admin_client.get(
            "/api/admin/displays/{0}/wall".format(me_id)
        )
        assert r.status_code == 404

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
