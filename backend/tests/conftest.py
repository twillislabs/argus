import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from argus import models  # noqa: F401
from argus.config import Settings
from argus.db import Base
from argus.main import create_app

SETUP_TOKEN = "ABCD-EFGH-JKMN"
PASSWORD = "correct horse battery staple"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite:///{0}".format(tmp_path / "test.db"),
        cookie_secure=False,
        nats_url="",
        setup_token=SETUP_TOKEN,
        login_max_failures=3,
        login_ip_limit=50,
    )


@pytest.fixture
async def app(settings):
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as c:
        yield c


def setup_body(**overrides):
    body = {
        "token": SETUP_TOKEN,
        "username": "Admin",
        "display_name": "Test Admin",
        "email": "admin@example.com",
        "password": PASSWORD,
        "home": {
            "name": "Nashville",
            "lat": 36.16,
            "lon": -86.78,
            "radius_km": 500,
            "tz": "America/Chicago",
        },
    }
    body.update(overrides)
    return body


@pytest.fixture
async def admin_client(client):
    response = await client.post("/api/setup", json=setup_body())
    assert response.status_code == 201, response.text
    return client


def csrf(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("argus_csrf", "")}
