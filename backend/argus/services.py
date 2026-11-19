"""Account, session, setup-token and audit operations."""

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from argus.config import Settings
from argus.db import utcnow
from argus.models import AuditLog, SetupToken, User, UserSession
from argus.security import (
    new_setup_token,
    new_token,
    normalize_setup_token,
    token_digest,
)

log = logging.getLogger("argus.setup")


async def user_count(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(User))
    return int(result.scalar_one())


async def audit(
    db: AsyncSession,
    action: str,
    user_id: int | None = None,
    ip: str | None = None,
    **detail: Any,
) -> None:
    db.add(AuditLog(action=action, user_id=user_id, ip=ip, detail=detail))


async def ensure_setup_token(
    db: AsyncSession, settings: Settings
) -> str | None:
    """Issue a fresh setup token while no users exist.

    Returns the plain token (also written to the log) or None when setup
    is already complete. Earlier unused tokens are revoked so only the
    newest one works.
    """
    if await user_count(db) > 0:
        return None
    await db.execute(delete(SetupToken).where(SetupToken.used_at.is_(None)))
    token = settings.setup_token or new_setup_token()
    expires = utcnow() + timedelta(hours=settings.setup_token_hours)
    db.add(
        SetupToken(
            token_hash=token_digest(normalize_setup_token(token)),
            expires_at=expires,
        )
    )
    await db.commit()
    log.warning(
        "No accounts exist yet. Argus setup token: {0} (expires {1:%Y-%m-%d"
        " %H:%M} UTC). Open Argus in a browser to finish setup.".format(
            token, expires
        )
    )
    return token


async def create_session(
    db: AsyncSession,
    user: User,
    settings: Settings,
    remember: bool,
    user_agent: str | None,
    ip: str | None,
) -> tuple[str, UserSession]:
    token = new_token()
    days = (
        settings.session_remember_days
        if remember
        else (settings.session_max_days)
    )
    session = UserSession(
        id=token_digest(token),
        user_id=user.id,
        csrf_token=new_token(24),
        expires_at=utcnow() + timedelta(days=days),
        remember=remember,
        user_agent=(user_agent or "")[:255] or None,
        ip=ip,
    )
    db.add(session)
    return token, session


async def load_session(
    db: AsyncSession, token: str, settings: Settings
) -> UserSession | None:
    """Return the live session for a cookie token, or None.

    Expired or idle sessions are deleted. last_seen_at is refreshed at
    most once a minute to avoid a write per request.
    """
    session = await db.get(UserSession, token_digest(token))
    if session is None:
        return None
    if session.user is None:  # the account is gone
        await db.delete(session)
        await db.commit()
        return None
    now = utcnow()
    idle = timedelta(hours=settings.session_idle_hours)
    expired = session.expires_at <= now
    # Wall screens (display role) sit unattended, so they don't idle out;
    # the absolute lifetime still applies.
    idle_ok = session.remember or session.user.role == "display"
    if not idle_ok and now - session.last_seen_at > idle:
        expired = True
    if expired or not session.user.is_active:
        await db.delete(session)
        await db.commit()
        return None
    if now - session.last_seen_at > timedelta(minutes=1):
        session.last_seen_at = now
        await db.commit()
    return session
