"""Sign in, sign out, and sign up when an admin allows it.

Sign-ups (Settings > Users > Sign-ups, server_settings["signup"]): off
unless an admin turns them on; new accounts get the chosen role (never
admin); with approval on they're created waiting (approval_pending) and
can't sign in until an admin approves them.
"""

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
from argus.models import ServerSetting, User
from argus.schemas import (
    LoginRequest,
    SignupRequest,
    SignupSettings,
    UserOut,
)
from argus.security import (
    hash_password,
    needs_rehash,
    password_problem,
    verify_password,
)
from argus.services import audit, create_session

router = APIRouter(tags=["auth"])

WRONG = "Wrong username or password."
PENDING = (
    "Your account is waiting for an administrator to approve it. Try "
    "again once they have."
)


async def read_signup(db) -> SignupSettings:
    row = await db.get(ServerSetting, "signup")
    try:
        return SignupSettings.model_validate((row.value or {}) if row else {})
    except ValueError:
        return SignupSettings()


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

    if user.approval_pending:
        # Only said once the password is right, so it reveals nothing.
        await db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, PENDING)
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


@router.post("/api/auth/signup", status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupRequest,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
):
    """Make an account, when sign-ups are on. With approval, the account
    waits (status pending, no session); without, it's signed in."""
    conf = await read_signup(db)
    if not conf.open:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This Argus doesn't take sign-ups. Ask an administrator for an "
            "account.",
        )
    ip = client_ip(request)
    if not request.app.state.signup_limiter.allow(ip or "unknown"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many sign-ups from this address. Try again later.",
        )
    username = body.username.lower()
    problem = password_problem(body.password, username)
    if problem:
        raise HTTPException(422, problem)
    taken = await db.execute(select(User.id).where(User.username == username))
    if taken.scalar_one_or_none() is not None:
        raise HTTPException(409, "That username is taken.")
    user = User(
        username=username,
        display_name=body.display_name.strip(),
        email=str(body.email) if body.email else None,
        password_hash=hash_password(body.password),
        role=conf.role,
        approval_pending=conf.approval,
        password_changed_at=utcnow(),
    )
    db.add(user)
    await db.flush()
    await audit(
        db,
        "auth.signup",
        user_id=user.id,
        ip=ip,
        username=username,
        pending=conf.approval,
    )
    if conf.approval:
        await db.commit()
        return {"status": "pending"}
    user.last_login_at = utcnow()
    token, session = await create_session(
        db,
        user,
        settings,
        remember=False,
        user_agent=request.headers.get("user-agent"),
        ip=ip,
    )
    await db.commit()
    set_session_cookies(response, token, session, settings)
    return {"status": "signed_in"}


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
