"""Shared request dependencies: database, client IP, auth and CSRF."""

from collections import deque
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from argus.config import Settings
from argus.db import utcnow
from argus.models import UserSession
from argus.security import digests_match
from argus.services import load_session

SESSION_COOKIE = "argus_session"
CSRF_COOKIE = "argus_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.db.sessionmaker() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[AsyncSession, Depends(get_db)]


def client_ip(request: Request) -> str | None:
    """The client address as seen by the API.

    Behind the bundled nginx this is the X-Real-IP it sets; uvicorn runs
    with --proxy-headers so request.client already reflects it.
    """
    return request.client.host if request.client else None


def set_session_cookies(
    response: Response,
    token: str,
    session: UserSession,
    settings: Settings,
) -> None:
    max_age = None
    if session.remember:
        max_age = int((session.expires_at - utcnow()).total_seconds())
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    # Readable by the page so it can echo it in the X-CSRF-Token header.
    response.set_cookie(
        CSRF_COOKIE,
        session.csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            name, path="/", secure=settings.cookie_secure, samesite="lax"
        )


async def current_session(
    request: Request, db: DbDep, settings: SettingsDep
) -> UserSession:
    token = request.cookies.get(SESSION_COOKIE)
    session = await load_session(db, token, settings) if token else None
    if session is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Sign in to continue."
        )
    if request.method not in SAFE_METHODS:
        sent = request.headers.get(CSRF_HEADER, "")
        if not sent or not digests_match(sent, session.csrf_token):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Missing or wrong CSRF token. Reload the page and retry.",
            )
    return session


SessionDep = Annotated[UserSession, Depends(current_session)]


class RateLimiter:
    """Sliding-window counter per key, kept in memory.

    Good enough for one API process. With several workers, each keeps
    its own window, so the effective limit scales with the worker count;
    per-account lockout in the database still applies.
    """

    def __init__(self, limit: int, window: timedelta) -> None:
        self.limit = limit
        self.window = window
        self.hits: dict[str, deque] = {}

    def allow(self, key: str) -> bool:
        now = utcnow()
        q = self.hits.setdefault(key, deque())
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True
