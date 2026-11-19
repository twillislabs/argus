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
            "profile": None,
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


async def test_wall_profiles(app, admin_client):
    import httpx

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as screen:
        start = (await screen.post("/api/display/pair/start")).json()
        ok = await admin_client.post(
            "/api/admin/displays",
            json={"code": start["code"], "name": "Ops TV"},
            headers=csrf(admin_client),
        )
        display_id = ok.json()["id"]
        await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )

        made = await admin_client.post(
            "/api/admin/wall-profiles",
            json={
                "name": "Weather desk",
                "wall": {
                    "layers": {
                        "wx_alerts": True,
                        "clouds": True,
                        "ships": False,
                    },
                    "sections": {"news": False, "weather": True},
                    "stop_s": 30,
                },
            },
            headers=csrf(admin_client),
        )
        assert made.status_code == 200, made.text
        pid = made.json()["id"]
        bad = await admin_client.post(
            "/api/admin/wall-profiles",
            json={"name": "x", "wall": {"sections": {"nope": True}}},
            headers=csrf(admin_client),
        )
        assert bad.status_code == 422

        url = "/api/admin/displays/{0}/wall".format(display_id)
        put = await admin_client.put(
            url, json={"wall": {}, "profile": pid}, headers=csrf(admin_client)
        )
        assert put.status_code == 200, put.text
        me = (await screen.get("/api/me")).json()["preferences"]
        assert me["wall"]["sections"]["weather"] is True
        assert me["wall_profile_name"] == "Weather desk"
        listed = (await admin_client.get("/api/admin/wall-profiles")).json()
        assert listed["profiles"][0]["screens"] == 1

        # Editing the profile reaches the screen.
        await admin_client.put(
            "/api/admin/wall-profiles/" + pid,
            json={"name": "Weather desk", "wall": {"stop_s": 45}},
            headers=csrf(admin_client),
        )
        me = (await screen.get("/api/me")).json()["preferences"]
        assert me["wall"]["stop_s"] == 45

        # Anyone signed in can preview a profile on /wall?profile=.
        one = (await admin_client.get("/api/wall-profiles/" + pid)).json()
        assert one["name"] == "Weather desk"

        # Deleting it sends the screen back to its own settings.
        gone = await admin_client.delete(
            "/api/admin/wall-profiles/" + pid, headers=csrf(admin_client)
        )
        assert gone.status_code == 200
        me = (await screen.get("/api/me")).json()["preferences"]
        assert "wall_profile" not in me and "wall_profile_name" not in me


async def test_sync_now(admin_client, app):
    import httpx

    from argus.api import displays

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as screen:
        start = (await screen.post("/api/display/pair/start")).json()
        ok = await admin_client.post(
            "/api/admin/displays",
            json={"code": start["code"], "name": "Ops TV"},
            headers=csrf(admin_client),
        )
        screen_id = ok.json()["id"]
        await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )
        first = (await screen.get("/api/display/sync")).json()
        assert first["boot"] == displays.BOOT_ID

        # Sync now for that screen moves its counter; Reload moves both.
        await admin_client.post(
            "/api/admin/displays/{0}/sync".format(screen_id),
            json={},
            headers=csrf(admin_client),
        )
        after = (await screen.get("/api/display/sync")).json()
        assert after["sync"] == first["sync"] + 1
        assert after["reload"] == first["reload"]
        await admin_client.post(
            "/api/admin/displays/sync",
            json={"reload": True},
            headers=csrf(admin_client),
        )
        every = (await screen.get("/api/display/sync")).json()
        assert every["sync"] == after["sync"] + 1
        assert every["reload"] == after["reload"] + 1
        # Saving the screen's settings pushes to it as well.
        await admin_client.put(
            "/api/admin/displays/{0}/wall".format(screen_id),
            json={"wall": {}, "home": None},
            headers=csrf(admin_client),
        )
        saved = (await screen.get("/api/display/sync")).json()
        assert saved["sync"] == every["sync"] + 1
        # Only admins push.
        r = await screen.post(
            "/api/admin/displays/sync", json={}, headers=csrf(screen)
        )
        assert r.status_code == 403


async def test_display_session_renews(admin_client, app):
    from datetime import timedelta

    import httpx
    from sqlalchemy import select

    from argus.db import utcnow
    from argus.models import User, UserSession

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as screen:
        start = (await screen.post("/api/display/pair/start")).json()
        await admin_client.post(
            "/api/admin/displays",
            json={"code": start["code"], "name": "Lobby"},
            headers=csrf(admin_client),
        )
        await screen.post(
            "/api/display/pair/poll", json={"token": start["token"]}
        )
        # Pretend the screen was paired 25 days ago.
        async with app.state.db.sessionmaker() as db:
            row = (
                await db.execute(
                    select(UserSession)
                    .join(User)
                    .where(User.role == "display")
                )
            ).scalar_one()
            row.expires_at = utcnow() + timedelta(days=5)
            await db.commit()
        r = await screen.get("/api/display/sync")
        assert r.status_code == 200
        assert "argus_session=" in r.headers.get("set-cookie", "")
        async with app.state.db.sessionmaker() as db:
            row = (
                await db.execute(
                    select(UserSession)
                    .join(User)
                    .where(User.role == "display")
                )
            ).scalar_one()
            assert row.expires_at - utcnow() > timedelta(days=29)
        # Fresh sessions aren't touched on every poll.
        again = await screen.get("/api/display/sync")
        assert "set-cookie" not in again.headers
