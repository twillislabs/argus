from datetime import timedelta

from sqlalchemy import select

from argus.db import utcnow
from argus.models import UserSession
from tests.conftest import PASSWORD, csrf


async def sign_out(client):
    response = await client.post("/api/auth/logout", headers=csrf(client))
    assert response.status_code == 204
    client.cookies.clear()


async def test_logout_then_login(admin_client):
    await sign_out(admin_client)
    assert (await admin_client.get("/api/me")).status_code == 401

    response = await admin_client.post(
        "/api/auth/login",
        json={"username": "ADMIN", "password": PASSWORD},
    )
    assert response.status_code == 200
    assert response.json()["username"] == "admin"
    assert (await admin_client.get("/api/me")).status_code == 200


async def test_wrong_password_is_generic(admin_client):
    await sign_out(admin_client)
    wrong = await admin_client.post(
        "/api/auth/login", json={"username": "admin", "password": "nope"}
    )
    missing = await admin_client.post(
        "/api/auth/login", json={"username": "ghost", "password": "nope"}
    )
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


async def test_lockout_after_failures(admin_client):
    await sign_out(admin_client)
    for _ in range(3):
        await admin_client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        )
    response = await admin_client.post(
        "/api/auth/login", json={"username": "admin", "password": PASSWORD}
    )
    assert response.status_code == 423


async def test_ip_rate_limit(admin_client, app):
    app.state.login_limiter.limit = 2
    app.state.login_limiter.hits.clear()
    await sign_out(admin_client)
    codes = []
    for _ in range(3):
        r = await admin_client.post(
            "/api/auth/login", json={"username": "x", "password": "y"}
        )
        codes.append(r.status_code)
    assert codes == [401, 401, 429]


async def test_csrf_required_for_writes(admin_client):
    response = await admin_client.patch(
        "/api/me/preferences", json={"basemap": "sat"}
    )
    assert response.status_code == 403
    response = await admin_client.patch(
        "/api/me/preferences",
        json={"basemap": "sat"},
        headers={"X-CSRF-Token": "forged"},
    )
    assert response.status_code == 403


async def test_preferences_merge_and_clear(admin_client):
    response = await admin_client.patch(
        "/api/me/preferences",
        json={"basemap": "sat"},
        headers=csrf(admin_client),
    )
    prefs = response.json()["preferences"]
    assert prefs["basemap"] == "sat"
    assert prefs["home"]["name"] == "Nashville"

    response = await admin_client.patch(
        "/api/me/preferences", json={"home": None}, headers=csrf(admin_client)
    )
    assert "home" not in response.json()["preferences"]

    response = await admin_client.patch(
        "/api/me/preferences",
        json={"unknown": 1},
        headers=csrf(admin_client),
    )
    assert response.status_code == 422


async def test_idle_session_expires(admin_client, app):
    async with app.state.db.sessionmaker() as db:
        session = (await db.execute(select(UserSession))).scalar_one()
        session.last_seen_at = utcnow() - timedelta(hours=13)
        await db.commit()
    assert (await admin_client.get("/api/me")).status_code == 401


async def test_remember_me_sets_persistent_cookie(admin_client):
    await sign_out(admin_client)
    response = await admin_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": PASSWORD, "remember": True},
    )
    cookie = response.headers.get("set-cookie", "")
    assert "Max-Age=" in cookie
    assert "HttpOnly" in cookie


async def test_api_security_headers(client):
    response = await client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in response.headers["content-security-policy"]
