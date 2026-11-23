import httpx

from tests.conftest import csrf


def visitor(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )


async def make_analyst(admin_client, name):
    r = await admin_client.post(
        "/api/admin/users",
        json={"username": name, "display_name": name, "role": "analyst"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 201, r.text
    return r.json()["user"]["id"], r.json()["temporary_password"]


async def signed_in(app, name, temp):
    """A client signed in as a new user who has chosen a password."""
    v = visitor(app)
    await v.post("/api/auth/login", json={"username": name, "password": temp})
    r = await v.post(
        "/api/me/password",
        json={
            "current_password": temp,
            "new_password": "a long enough passphrase 9",
        },
        headers=csrf(v),
    )
    assert r.status_code == 204, r.text
    return v


async def test_groups_limit_ai(app, admin_client):
    alice, alice_pw = await make_analyst(admin_client, "alice")
    bob, bob_pw = await make_analyst(admin_client, "bob")
    h = csrf(admin_client)
    r = await admin_client.post(
        "/api/admin/groups",
        json={"name": "AI users", "members": [alice, 99999]},
        headers=h,
    )
    assert r.status_code == 201, r.text
    group = r.json()
    assert group["members"] == [alice]
    r = await admin_client.post(
        "/api/admin/groups", json={"name": "AI users"}, headers=h
    )
    assert r.status_code == 409

    a = await signed_in(app, "alice", alice_pw)
    b = await signed_in(app, "bob", bob_pw)
    # Before any limit both analysts may use AI.
    for c in (a, b):
        caps = (await c.get("/api/me")).json()["user"]["capabilities"]
        assert "ai.use" in caps

    r = await admin_client.put(
        "/api/admin/access",
        json={"rules": {"ai.use": {"mode": "only", "groups": [group["id"]]}}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["rules"]["ai.use"]["mode"] == "only"

    caps_a = (await a.get("/api/me")).json()["user"]["capabilities"]
    caps_b = (await b.get("/api/me")).json()["user"]["capabilities"]
    assert "ai.use" in caps_a and "ai.use" not in caps_b
    assert (await b.get("/api/ai/status")).json()["can_use"] is False
    # Admins always keep it.
    me = (await admin_client.get("/api/me")).json()
    assert "ai.use" in me["user"]["capabilities"]

    # Name bob directly: now he may too.
    await admin_client.put(
        "/api/admin/access",
        json={
            "rules": {
                "ai.use": {
                    "mode": "only",
                    "groups": [group["id"]],
                    "users": [bob],
                }
            }
        },
        headers=h,
    )
    caps_b = (await b.get("/api/me")).json()["user"]["capabilities"]
    assert "ai.use" in caps_b

    r = await admin_client.put(
        "/api/admin/access",
        json={"rules": {"users.manage": {"mode": "only"}}},
        headers=h,
    )
    assert r.status_code == 422
    for c in (a, b):
        await c.aclose()


async def test_limited_tokens_stop_working(app, admin_client):
    carol, carol_pw = await make_analyst(admin_client, "carol")
    c = await signed_in(app, "carol", carol_pw)
    r = await c.post(
        "/api/me/tokens", json={"name": "script"}, headers=csrf(c)
    )
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    bearer = {"Authorization": "Bearer {0}".format(token)}
    async with visitor(app) as v:
        assert (await v.get("/api/events", headers=bearer)).status_code == 200
        await admin_client.put(
            "/api/admin/access",
            json={"rules": {"api.tokens": {"mode": "only"}}},
            headers=csrf(admin_client),
        )
        assert (await v.get("/api/events", headers=bearer)).status_code == 401
    r = await c.get("/api/me/tokens")
    assert r.status_code == 403
    await c.aclose()


async def test_deleting_a_group(app, admin_client):
    h = csrf(admin_client)
    g = (
        await admin_client.post(
            "/api/admin/groups", json={"name": "Night shift"}, headers=h
        )
    ).json()
    r = await admin_client.delete(
        "/api/admin/groups/{0}".format(g["id"]), headers=h
    )
    assert r.status_code == 204
    groups = (await admin_client.get("/api/admin/groups")).json()["groups"]
    assert groups == []
