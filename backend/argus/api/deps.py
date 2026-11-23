"""Shared request dependencies: database, client IP, auth and CSRF."""

from collections import deque
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from argus import access
from argus.config import Settings
from argus.db import utcnow
from argus.models import ApiToken, UserSession
from argus.roles import can
from argus.security import digests_match, token_digest
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


TOKEN_PREFIX = "argus_"  # noqa: S105 - a prefix, not a secret
# What an API token may read: map data, never accounts, admin or backups.
TOKEN_PATHS = (
    "/api/summary",
    "/api/tension",
    "/api/events",
    "/api/search",
    "/api/places",
    "/api/aircraft",
    "/api/vessels",
    "/api/weather/",
    "/api/cams",
    "/api/transit",
    "/api/news",
    "/api/launches",
    "/api/spaceweather",
    "/api/satellites",
    "/api/gps",
    "/api/airspace",
    "/api/advisories",
)


def token_allowed(path: str) -> bool:
    return any(
        path == p or path.startswith(p if p.endswith("/") else p + "/")
        for p in TOKEN_PATHS
    )


async def token_session(db: AsyncSession, header: str) -> UserSession | None:
    """A Bearer API token as a session that's never stored: the token's
    user, read-only. None when there's no such token or the account
    can't use one."""
    if not header.startswith("Bearer " + TOKEN_PREFIX):
        return None
    row = await db.scalar(
        select(ApiToken).where(
            ApiToken.digest == token_digest(header[len("Bearer ") :])
        )
    )
    if (
        row is None
        or row.user is None
        or not row.user.is_active
        or row.user.must_change_password
        or row.user.role == "display"
        or row.user.approval_pending
        or not await access.may(db, row.user, "api.tokens")
    ):
        return None
    now = utcnow()
    if row.last_used_at is None or now - row.last_used_at > timedelta(
        minutes=5
    ):
        row.last_used_at = now
        await db.commit()
    return UserSession(
        id="token:{0}".format(row.id),
        user_id=row.user_id,
        user=row.user,
        csrf_token="",
        created_at=row.created_at,
        last_seen_at=now,
        expires_at=now,
    )


async def current_session(
    request: Request, db: DbDep, settings: SettingsDep
) -> UserSession:
    token = request.cookies.get(SESSION_COOKIE)
    session = await load_session(db, token, settings) if token else None
    if session is None and not token:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            session = await token_session(db, auth)
            if session is None:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, "That API token isn't valid."
                )
            if request.method not in SAFE_METHODS or not token_allowed(
                request.url.path
            ):
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "API tokens are read-only and only read map data.",
                )
            return session
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
    # A temporary password (set by an admin) must be replaced before the
    # account can do anything else.
    if (
        session.user.must_change_password
        and request.url.path not in PASSWORD_CHANGE_PATHS
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Choose a new password to continue.",
            headers={"X-Argus-Reason": "password-change"},
        )
    return session


SessionDep = Annotated[UserSession, Depends(current_session)]

PASSWORD_CHANGE_PATHS = {
    "/api/me",
    "/api/me/password",
    "/api/auth/logout",
}


def require(capability: str):
    """Dependency: the signed-in user's role must have capability."""

    async def check(session: SessionDep, db: DbDep) -> UserSession:
        if not can(session.user.role, capability):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Your role can't do this. Ask an administrator.",
            )
        # An admin may have limited this feature to some groups.
        if not await access.may(db, session.user, capability):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This feature is limited to some groups. Ask an "
                "administrator for access.",
            )
        return session

    return check


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
