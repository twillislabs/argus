from sqlalchemy import select

from argus import secrets
from argus.api import admin
from argus.models import ServerSetting, User
from tests.conftest import csrf

KEY = "AIzaTESTKEY0000000000000000000000001234"


async def put(client, **body):
    return await client.put(
        "/api/admin/imagery", json=body, headers=csrf(client)
    )


async def test_imagery_defaults_and_map_config(admin_client):
    view = (await admin_client.get("/api/admin/imagery")).json()
    assert view["provider"] == "esri" and not view["google_key_set"]
    config = (await admin_client.get("/api/map/config")).json()
    assert config["imagery"] == {
        "provider": "esri",
        "google_key": None,
        "google_3d": False,
    }


async def test_google_key_saved_encrypted(admin_client, app, monkeypatch):
    seen = []

    async def accept(key):
        seen.append(key)
        return None

    monkeypatch.setattr(admin, "check_google_key", accept)
    response = await put(
        admin_client, provider="google", google_key=KEY, google_3d=True
    )
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["google_key_set"] and view["google_key_hint"] == "…1234"
    assert KEY not in response.text
    assert seen == [KEY]

    async with app.state.db.sessionmaker() as db:
        row = await db.get(ServerSetting, "imagery")
        assert KEY not in str(row.value)
        assert (
            secrets.decrypt(
                app.state.settings.secret_key, row.value["google_key"]
            )
            == KEY
        )

    config = (await admin_client.get("/api/map/config")).json()["imagery"]
    assert config == {
        "provider": "google",
        "google_key": KEY,
        "google_3d": True,
    }

    # Keep the key when it's omitted; switching to Esri hides it.
    response = await put(admin_client, provider="esri", google_3d=True)
    assert response.json()["google_key_set"]
    assert response.json()["google_3d"] is False
    config = (await admin_client.get("/api/map/config")).json()["imagery"]
    assert config["google_key"] is None

    # "" removes it.
    response = await put(admin_client, provider="esri", google_key="")
    assert not response.json()["google_key_set"]


async def test_google_needs_valid_key(admin_client, monkeypatch):
    async def refuse(key):
        return "Google refused the key: API key not valid."

    monkeypatch.setattr(admin, "check_google_key", refuse)
    response = await put(admin_client, provider="google", google_key="bad")
    assert response.status_code == 422
    assert "refused" in response.json()["detail"]
    response = await put(admin_client, provider="google")
    assert response.status_code == 422
    assert "Add a Google" in response.json()["detail"]


async def test_key_unreadable_after_secret_change(admin_client, app):
    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="imagery",
                value={
                    "provider": "google",
                    "google_key": secrets.encrypt("another secret", KEY),
                },
            )
        )
        await db.commit()
    view = (await admin_client.get("/api/admin/imagery")).json()
    assert view["google_key_unreadable"] and not view["google_key_set"]
    config = (await admin_client.get("/api/map/config")).json()["imagery"]
    assert config["provider"] == "esri"


async def test_only_admins_change_imagery(admin_client, app):
    async with app.state.db.sessionmaker() as db:
        user = (await db.execute(select(User))).scalar_one()
        user.role = "viewer"
        await db.commit()
    assert (await admin_client.get("/api/admin/imagery")).status_code == 403
    response = await put(admin_client, provider="esri")
    assert response.status_code == 403
    assert (await admin_client.get("/api/map/config")).status_code == 200


async def test_requires_sign_in_and_csrf(client, admin_client):
    response = await admin_client.put(
        "/api/admin/imagery", json={"provider": "esri"}
    )
    assert response.status_code == 403
