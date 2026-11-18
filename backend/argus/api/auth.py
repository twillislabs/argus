"""Sign in and sign out."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from argus.api.deps import (
    DbDep,
    SessionDep,
    SettingsDep,
    clear_session_cookies,
    client_ip,
    set_session_cookies,
)
from argus.db import utcnow
from argus.models import User
from argus.schemas import LoginRequest, UserOut
from argus.security import hash_password, needs_rehash, verify_password
from argus.services import audit, create_session

router = APIRouter(tags=["auth"])

WRONG = "Wrong username or password."


@router.post("/api/auth/login", response_model=UserOut)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
) -> User:
    ip = client_ip(request)
    limiter = request.app.state.login_limiter
    if not limiter.allow(ip or "unknown"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many sign-in attempts from this address. Wait a few "
            "minutes and try again.",
        )
    username = body.username.strip().lower()
    user = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    now = utcnow()
    if user is not None and user.locked_until and user.locked_until > now:
        # Still verify, so a locked account takes as long as any other.
        verify_password(user.password_hash, body.password)
        raise HTTPException(
            status.HTTP_423_LOCKED,
            "This account is locked after too many failed sign-ins. Try "
            "again in {0} minutes.".format(settings.login_lockout_minutes),
        )
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or not user.is_active:
        if user is not None:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_failures:
                user.locked_until = now + timedelta(
                    minutes=settings.login_lockout_minutes
                )
                user.failed_logins = 0
                await audit(db, "auth.locked", user_id=user.id, ip=ip)
        await audit(
            db,
            "auth.login_failed",
            user_id=user.id if user else None,
            ip=ip,
            username=username[:32],
        )
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, WRONG)

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    token, session = await create_session(
        db,
        user,
        settings,
        remember=body.remember,
        user_agent=request.headers.get("user-agent"),
        ip=ip,
    )
    await audit(db, "auth.login", user_id=user.id, ip=ip)
    await db.commit()
    set_session_cookies(response, token, session, settings)
    return user


@router.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    session: SessionDep,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
) -> Response:
    await audit(
        db, "auth.logout", user_id=session.user_id, ip=client_ip(request)
    )
    await db.delete(await db.merge(session))
    await db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookies(response, settings)
    return response
