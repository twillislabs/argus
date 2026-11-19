"""First-run setup: create the admin account with the setup token."""

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from argus.api.deps import (
    DbDep,
    SettingsDep,
    client_ip,
    set_session_cookies,
)
from argus.db import utcnow
from argus.models import SetupToken, User, UserPreferences
from argus.schemas import SetupRequest, SetupStatus, UserOut
from argus.security import (
    digests_match,
    hash_password,
    normalize_setup_token,
    password_problem,
    token_digest,
)
from argus.services import audit, create_session, user_count

router = APIRouter(tags=["setup"])


@router.get("/api/setup/status", response_model=SetupStatus)
async def setup_status(db: DbDep, settings: SettingsDep) -> SetupStatus:
    return SetupStatus(
        needs_setup=await user_count(db) == 0,
        secure_cookies=settings.cookie_secure,
    )


@router.post(
    "/api/setup",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
async def run_setup(
    body: SetupRequest,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
) -> User:
    ip = client_ip(request)
    if await user_count(db) > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Setup is already complete."
        )
    digest = token_digest(normalize_setup_token(body.token))
    rows = await db.execute(
        select(SetupToken)
        .where(SetupToken.used_at.is_(None))
        .where(SetupToken.expires_at > utcnow())
        .with_for_update()
    )
    match = next(
        (t for t in rows.scalars() if digests_match(t.token_hash, digest)),
        None,
    )
    if match is None:
        await audit(db, "setup.token_rejected", ip=ip)
        await db.commit()
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "The setup token is wrong or has expired. Restart the API to "
            "print a new one.",
        )
    username = body.username.lower()
    problem = password_problem(body.password, username)
    if problem:
        raise HTTPException(422, problem)

    user = User(
        username=username,
        display_name=body.display_name.strip(),
        email=str(body.email) if body.email else None,
        password_hash=hash_password(body.password),
        role="admin",
        last_login_at=utcnow(),
    )
    db.add(user)
    await db.flush()
    prefs = {"home": body.home.model_dump()} if body.home else {}
    db.add(UserPreferences(user_id=user.id, data=prefs))
    match.used_at = utcnow()
    token, session = await create_session(
        db,
        user,
        settings,
        remember=False,
        user_agent=request.headers.get("user-agent"),
        ip=ip,
    )
    await audit(db, "setup.completed", user_id=user.id, ip=ip)
    await db.commit()
    set_session_cookies(response, token, session, settings)
    return user
