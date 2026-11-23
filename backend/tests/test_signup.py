import httpx

from tests.conftest import csrf

PASSWORD = "a long enough passphrase 9"


def visitor(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )


def signup(name="newbie", password=PASSWORD):
    return {
        "username": name,
        "display_name": "New Person",
        "password": password,
    }


async def set_signup(admin_client, **conf):
    r = await admin_client.put(
        "/api/admin/signup", json=conf, headers=csrf(admin_client)
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_signup_closed_by_default(app, admin_client):
    async with visitor(app) as v:
        status = (await v.get("/api/setup/status")).json()
        assert status["signup"] is False
        r = await v.post("/api/auth/signup", json=signup())
        assert r.status_code == 403


async def test_signup_with_approval(app, admin_client):
    conf = await set_signup(admin_client, open=True)
    assert conf == {"open": True, "approval": True, "role": "viewer"}
    async with visitor(app) as v:
        assert (await v.get("/api/setup/status")).json()["signup"] is True
        r = await v.post("/api/auth/signup", json=signup())
        assert r.status_code == 201 and r.json() == {"status": "pending"}
        # Waiting: the right password says so, a wrong one doesn't.
        r = await v.post(
            "/api/auth/login",
            json={"username": "newbie", "password": "wrong password!!"},
        )
        assert r.status_code == 401
        r = await v.post(
            "/api/auth/login",
            json={"username": "newbie", "password": PASSWORD},
        )
        assert r.status_code == 403 and "approve" in r.json()["detail"]
        r = await v.post("/api/auth/signup", json=signup())
        assert r.status_code == 409
    me = (await admin_client.get("/api/me")).json()
    assert me["pending_signups"] == 1
    users = (await admin_client.get("/api/admin/users")).json()
    newbie = next(u for u in users if u["username"] == "newbie")
    assert newbie["approval_pending"] and newbie["role"] == "viewer"
    r = await admin_client.post(
        "/api/admin/users/{0}/approve".format(newbie["id"]),
        headers=csrf(admin_client),
    )
    assert r.status_code == 200 and not r.json()["approval_pending"]
    async with visitor(app) as v:
        r = await v.post(
            "/api/auth/login",
            json={"username": "newbie", "password": PASSWORD},
        )
        assert r.status_code == 200


async def test_signup_without_approval_signs_in(app, admin_client):
    await set_signup(admin_client, open=True, approval=False, role="analyst")
    async with visitor(app) as v:
        r = await v.post("/api/auth/signup", json=signup("quick"))
        assert r.json() == {"status": "signed_in"}
        me = (await v.get("/api/me")).json()
        assert me["user"]["username"] == "quick"
        assert me["user"]["role"] == "analyst"
        assert me["pending_signups"] == 0


async def test_signup_refuses_weak_password_and_admin_role(app, admin_client):
    r = await admin_client.put(
        "/api/admin/signup",
        json={"open": True, "role": "admin"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 422
    await set_signup(admin_client, open=True)
    async with visitor(app) as v:
        r = await v.post("/api/auth/signup", json=signup(password="short"))
        assert r.status_code == 422
