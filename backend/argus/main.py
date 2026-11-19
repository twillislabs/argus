"""FastAPI application factory."""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, Request

from argus import __version__
from argus.alpr import Alpr
from argus.api import (
    admin,
    air,
    airspace,
    auth,
    cams,
    displays,
    events,
    health,
    me,
    setup,
    users,
    weather,
)
from argus.api import sea as sea_api
from argus.api import space as space_api
from argus.api.deps import RateLimiter
from argus.aviation import AirClient, GpsGrid, LiveAir
from argus.config import DEFAULT_SECRET, Settings, get_settings
from argus.db import Database
from argus.live import Hub, subscribe_forever
from argus.openaip import OpenAip
from argus.sea import LiveSea
from argus.services import ensure_setup_token
from argus.youtube import LiveIds

log = logging.getLogger("argus")


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="{asctime} {levelname:<7} {name}: {message}",
        style="{",
    )
    # httpx logs every request at INFO; keep those for debugging only.
    logging.getLogger("httpx").setLevel(logging.WARNING)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.database_url)
        app.state.db = db
        if settings.secret_key == DEFAULT_SECRET:
            log.warning(
                "ARGUS_SECRET_KEY is the default. Set a long random value "
                "in .env before exposing Argus."
            )
        async with db.sessionmaker() as session:
            await ensure_setup_token(session, settings)
        app.state.hub = Hub()
        app.state.air = LiveAir()
        app.state.local_air = LiveAir()
        app.state.sea = LiveSea()
        app.state.gps = GpsGrid()
        app.state.air_client = AirClient(settings.user_agent)
        app.state.air_client.gps = app.state.gps
        app.state.openaip = OpenAip(settings.user_agent)
        app.state.alpr = Alpr(settings.user_agent, app.state.db)
        app.state.youtube = LiveIds(settings.user_agent)
        live_task = None
        if settings.nats_url:
            live_task = asyncio.create_task(
                subscribe_forever(
                    settings.nats_url,
                    app.state.hub,
                    app.state.air,
                    app.state.sea,
                    app.state.local_air,
                    app.state.gps,
                )
            )
        yield
        if live_task is not None:
            live_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await live_task
        await app.state.air_client.close()
        await app.state.openaip.close()
        await app.state.alpr.close()
        await app.state.youtube.close()
        if hasattr(app.state, "weather_http"):
            await app.state.weather_http.aclose()
        await db.dispose()

    app = FastAPI(
        title="Argus API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.login_limiter = RateLimiter(
        settings.login_ip_limit,
        timedelta(minutes=settings.login_ip_window_minutes),
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("Referrer-Policy", "same-origin")
        headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/api/") and not (
            request.url.path.startswith("/api/docs")
        ):
            headers.setdefault("Cache-Control", "no-store")
            headers.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'",
            )
        return response

    for router in (
        cams.router,
        health.router,
        setup.router,
        auth.router,
        me.router,
        events.router,
        air.router,
        admin.router,
        users.router,
        space_api.router,
        sea_api.router,
        airspace.router,
        displays.router,
        weather.router,
    ):
        app.include_router(router)
    return app


app = create_app()
