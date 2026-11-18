from sqlalchemy import select

from argus.models import AuditLog, SetupToken, User
from tests.conftest import setup_body


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


async def test_status_needs_setup(client):
    response = await client.get("/api/setup/status")
    assert response.json() == {"needs_setup": True}


async def test_setup_creates_admin_and_signs_in(client, app):
    response = await client.post("/api/setup", json=setup_body())
    assert response.status_code == 201
    user = response.json()
    assert user["username"] == "admin"
    assert user["role"] == "admin"
    assert "argus_session" in client.cookies
    assert "argus_csrf" in client.cookies

    me = await client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["preferences"]["home"]["name"] == "Nashville"

    status = await client.get("/api/setup/status")
    assert status.json() == {"needs_setup": False}

    async with app.state.db.sessionmaker() as db:
        token = (await db.execute(select(SetupToken))).scalar_one()
        assert token.used_at is not None
        actions = (await db.execute(select(AuditLog.action))).scalars()
        assert "setup.completed" in list(actions)


async def test_token_is_case_and_dash_insensitive(client):
    body = setup_body(token="abcd efgh jkmn")
    response = await client.post("/api/setup", json=body)
    assert response.status_code == 201


async def test_wrong_token_rejected(client):
    response = await client.post(
        "/api/setup", json=setup_body(token="WRON-GTOK-ENXX")
    )
    assert response.status_code == 403
    assert "setup token" in response.json()["detail"]


async def test_setup_only_once(admin_client):
    response = await admin_client.post(
        "/api/setup", json=setup_body(username="second")
    )
    assert response.status_code == 409


async def test_weak_passwords_rejected(client):
    for password, reason in (
        ("short", "at least 12"),
        ("admin-is-my-password", "username"),
        ("aaaaaaaaaaaaaaaa", "easy to guess"),
    ):
        response = await client.post(
            "/api/setup", json=setup_body(password=password)
        )
        assert response.status_code == 422, password
        assert reason in response.json()["detail"], password


async def test_bad_home_rejected(client):
    body = setup_body()
    body["home"]["tz"] = "Mars/Olympus_Mons"
    response = await client.post("/api/setup", json=body)
    assert response.status_code == 422


async def test_setup_rejects_form_posts(client):
    response = await client.post(
        "/api/setup",
        data={"token": "ABCD-EFGH-JKMN", "username": "x"},
    )
    assert response.status_code == 422


async def test_password_is_hashed(admin_client, app):
    async with app.state.db.sessionmaker() as db:
        user = (await db.execute(select(User))).scalar_one()
    assert user.password_hash.startswith("$argon2id$")
