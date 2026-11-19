from datetime import timedelta

import httpx
from sqlalchemy import select

from argus.db import utcnow
from argus.models import AuditLog, User, UserSession
from tests.conftest import PASSWORD, csrf

NEW_PASSWORD = "a brand new long passphrase"


async def create(client, **body):
    body = {"username": "jordan", "display_name": "Jordan", **body}
    return await client.post(
        "/api/admin/users", json=body, headers=csrf(client)
    )


async def sign_in(app, username, password):
    transport = httpx.ASGITransport(app=app)
    c = httpx.AsyncClient(transport=transport, base_url="http://testserver")
    r = await c.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    return c, r


async def test_create_user_and_first_sign_in(admin_client, app):
    r = await create(admin_client, role="analyst", email="j@example.com")
    assert r.status_code == 201, r.text
    body = r.json()
    temp = body["temporary_password"]
    assert body["user"]["role"] == "analyst"
    assert body["user"]["must_change_password"]
    assert len(temp) == 23 and temp.count("-") == 3

    users = (await admin_client.get("/api/admin/users")).json()
    assert [u["username"] for u in users] == ["admin", "jordan"]
    assert "password_hash" not in users[1]

    c, r = await sign_in(app, "Jordan", temp)
    assert r.status_code == 200 and r.json()["must_change_password"]
    # Until the password is changed, only /api/me and the change work.
    assert (await c.get("/api/me")).status_code == 200
    blocked = await c.get("/api/events")
    assert blocked.status_code == 403
    assert blocked.headers["x-argus-reason"] == "password-change"
    r = await c.post(
        "/api/me/password",
        json={"current_password": temp, "new_password": NEW_PASSWORD},
        headers=csrf(c),
    )
    assert r.status_code == 204, r.text
    me = (await c.get("/api/me")).json()["user"]
    assert not me["must_change_password"]
    assert "analyst.tools" in me["capabilities"]
    assert "users.manage" not in me["capabilities"]
    assert (await c.get("/api/events")).status_code == 200
    # Analysts can't manage users or server settings.
    assert (await c.get("/api/admin/users")).status_code == 403
    assert (await c.get("/api/admin/imagery")).status_code == 403
    await c.aclose()

    assert (await create(admin_client)).status_code == 409


async def test_role_guards(admin_client, app):
    me = (await admin_client.get("/api/me")).json()["user"]
    patch = admin_client.patch
    url = "/api/admin/users/{0}".format(me["id"])
    r = await patch(url, json={"role": "viewer"}, headers=csrf(admin_client))
    assert r.status_code == 409
    r = await patch(url, json={"is_active": False}, headers=csrf(admin_client))
    assert r.status_code == 409
    r = await admin_client.delete(url, headers=csrf(admin_client))
    assert r.status_code == 409

    other = (await create(admin_client, role="admin")).json()["user"]
    other_url = "/api/admin/users/{0}".format(other["id"])
    r = await patch(
        other_url, json={"role": "display"}, headers=csrf(admin_client)
    )
    assert r.status_code == 200 and r.json()["role"] == "display"
    assert "display" in [
        x["id"]
        for x in (await admin_client.get("/api/admin/roles")).json()["roles"]
    ]
    r = await admin_client.delete(other_url, headers=csrf(admin_client))
    assert r.status_code == 204
    async with app.state.db.sessionmaker() as db:
        actions = [
            a.action for a in (await db.execute(select(AuditLog))).scalars()
        ]
    assert "users.create" in actions and "users.delete" in actions


async def test_deactivate_and_reset_end_sessions(admin_client, app):
    created = (await create(admin_client)).json()
    temp = created["temporary_password"]
    url = "/api/admin/users/{0}".format(created["user"]["id"])
    c, _ = await sign_in(app, "jordan", temp)
    await c.post(
        "/api/me/password",
        json={"current_password": temp, "new_password": NEW_PASSWORD},
        headers=csrf(c),
    )
    assert (await c.get("/api/me")).status_code == 200

    r = await admin_client.post(
        url + "/reset-password", headers=csrf(admin_client)
    )
    new_temp = r.json()["temporary_password"]
    assert new_temp != temp
    assert (await c.get("/api/me")).status_code == 401
    _, r = await sign_in(app, "jordan", NEW_PASSWORD)
    assert r.status_code == 401
    c2, r = await sign_in(app, "jordan", new_temp)
    assert r.json()["must_change_password"]

    r = await admin_client.patch(
        url, json={"is_active": False}, headers=csrf(admin_client)
    )
    assert r.json()["is_active"] is False
    assert (await c2.get("/api/me")).status_code == 401
    _, r = await sign_in(app, "jordan", new_temp)
    assert r.status_code == 401
    await c.aclose()
    await c2.aclose()


async def test_change_own_password_rules(admin_client):
    async def change(current, new):
        return await admin_client.post(
            "/api/me/password",
            json={"current_password": current, "new_password": new},
            headers=csrf(admin_client),
        )

    assert (await change("wrong", NEW_PASSWORD)).status_code == 403
    assert (await change(PASSWORD, "short")).status_code == 422
    assert (await change(PASSWORD, PASSWORD)).status_code == 422
    assert (await change(PASSWORD, NEW_PASSWORD)).status_code == 204
    # This session stays signed in.
    assert (await admin_client.get("/api/me")).status_code == 200

    r = await admin_client.patch(
        "/api/me/profile",
        json={"display_name": "Chief", "email": None},
        headers=csrf(admin_client),
    )
    assert r.json()["display_name"] == "Chief" and r.json()["email"] is None


async def test_display_accounts(admin_client, app):
    created = (await create(admin_client, role="display")).json()
    temp = created["temporary_password"]
    c, _ = await sign_in(app, "jordan", temp)
    # A display account still sets its first password itself...
    r = await c.post(
        "/api/me/password",
        json={"current_password": temp, "new_password": NEW_PASSWORD},
        headers=csrf(c),
    )
    assert r.status_code == 204
    # ...but then an admin manages it.
    r = await c.post(
        "/api/me/password",
        json={"current_password": NEW_PASSWORD, "new_password": temp + "x"},
        headers=csrf(c),
    )
    assert r.status_code == 403
    # And it doesn't idle out.
    async with app.state.db.sessionmaker() as db:
        s = (
            await db.execute(
                select(UserSession).join(User).where(User.role == "display")
            )
        ).scalar_one()
        s.last_seen_at = utcnow() - timedelta(hours=48)
        await db.commit()
    assert (await c.get("/api/me")).status_code == 200
    await c.aclose()


async def test_viewers_cant_manage(admin_client, app):
    temp = (await create(admin_client)).json()["temporary_password"]
    c, _ = await sign_in(app, "jordan", temp)
    await c.post(
        "/api/me/password",
        json={"current_password": temp, "new_password": NEW_PASSWORD},
        headers=csrf(c),
    )
    for path in ("/api/admin/users", "/api/admin/roles"):
        assert (await c.get(path)).status_code == 403
    r = await c.post(
        "/api/admin/users",
        json={"username": "sneaky", "display_name": "S", "role": "admin"},
        headers=csrf(c),
    )
    assert r.status_code == 403
    await c.aclose()


async def test_audit_log(admin_client, client):
    await create(admin_client)
    r = await admin_client.get("/api/admin/audit")
    entries = r.json()["entries"]
    assert entries[0]["action"] == "users.create"
    assert entries[0]["username"] == "admin"
    older = await admin_client.get(
        "/api/admin/audit", params={"before": entries[0]["id"], "limit": 1}
    )
    assert older.json()["entries"][0]["id"] < entries[0]["id"]
    only = await admin_client.get(
        "/api/admin/audit", params={"action": "users."}
    )
    assert all(
        e["action"].startswith("users.") for e in only.json()["entries"]
    )
