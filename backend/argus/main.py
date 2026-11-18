"""FastAPI application factory."""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, Request

from argus import __version__
from argus.api import air, auth, events, health, me, setup
from argus.api.deps import RateLimiter
from argus.aviation import AirClient, LiveAir
from argus.config import DEFAULT_SECRET, Settings, get_settings
from argus.db import Database
from argus.live import Hub, subscribe_forever
from argus.services import ensure_setup_token

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
        app.state.air_client = AirClient(settings.user_agent)
        live_task = None
        if settings.nats_url:
            live_task = asyncio.create_task(
                subscribe_forever(
                    settings.nats_url, app.state.hub, app.state.air
                )
            )
        yield
        if live_task is not None:
            live_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await live_task
        await app.state.air_client.close()
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
        health.router,
        setup.router,
        auth.router,
        me.router,
        events.router,
        air.router,
    ):
        app.include_router(router)
    return app


app = create_app()
