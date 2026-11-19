"""User management (admins) and each user's own account.

Admins create accounts with a temporary password that's shown once; the
user must replace it at first sign-in. Resetting a password does the
same and signs the user out everywhere. Guards: an admin can't change
their own role or deactivate or delete themselves, and the last active
admin can't be demoted, deactivated or deleted.
"""

from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from sqlalchemy import delete, func, select

from argus.api.deps import (
    DbDep,
    SessionDep,
    client_ip,
    require,
)
from argus.db import utcnow
from argus.models import User, UserSession
from argus.roles import ROLE_LABELS, can
from argus.schemas import (
    AdminUserOut,
    PasswordChange,
    ProfileUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)
from argus.security import (
    hash_password,
    new_temp_password,
    password_problem,
    verify_password,
)
from argus.services import audit

router = APIRouter(tags=["users"])
ManageDep = Annotated[UserSession, Depends(require("users.manage"))]


async def _active_admins(db, excluding: int | None = None) -> int:
    query = select(func.count(User.id)).where(
        User.role == "admin", User.is_active.is_(True)
    )
    if excluding is not None:
        query = query.where(User.id != excluding)
    return (await db.execute(query)).scalar_one()


async def _end_sessions(db, user_id: int, keep: str | None = None) -> None:
    query = delete(UserSession).where(UserSession.user_id == user_id)
    if keep:
        query = query.where(UserSession.id != keep)
    await db.execute(query)


async def _get(db, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "No user with that id.")
    return user


@router.get("/api/admin/roles")
async def list_roles(session: ManageDep):
    return {
        "roles": [
            {"id": role, "label": label} for role, label in ROLE_LABELS.items()
        ]
    }


@router.get("/api/admin/users", response_model=list[AdminUserOut])
async def list_users(db: DbDep, session: ManageDep):
    rows = await db.execute(select(User).order_by(User.username))
    return list(rows.scalars())


@router.post("/api/admin/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    request: Request,
    db: DbDep,
    session: ManageDep,
):
    username = body.username.lower()
    taken = await db.execute(select(User.id).where(User.username == username))
    if taken.scalar_one_or_none() is not None:
        raise HTTPException(409, "That username is taken.")
    temp = new_temp_password()
    user = User(
        username=username,
        display_name=body.display_name.strip(),
        email=str(body.email) if body.email else None,
        password_hash=hash_password(temp),
        role=body.role,
        must_change_password=True,
    )
    db.add(user)
    await db.flush()
    await audit(
        db,
        "users.create",
        session.user_id,
        client_ip(request),
        target=user.id,
        username=username,
        role=body.role,
    )
    await db.commit()
    await db.refresh(user)
    return {
        "user": AdminUserOut.model_validate(user),
        "temporary_password": temp,
    }


@router.patch("/api/admin/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    db: DbDep,
    session: ManageDep,
):
    user = await _get(db, user_id)
    changes = body.model_dump(exclude_unset=True)
    self_edit = user.id == session.user_id
    if self_edit and "role" in changes and changes["role"] != user.role:
        raise HTTPException(
            409, "You can't change your own role. Ask another admin."
        )
    if self_edit and changes.get("is_active") is False:
        raise HTTPException(409, "You can't deactivate your own account.")
    losing_admin = (
        user.role == "admin"
        and user.is_active
        and (
            changes.get("role", "admin") != "admin"
            or changes.get("is_active") is False
        )
    )
    if losing_admin and await _active_admins(db, excluding=user.id) == 0:
        raise HTTPException(
            409, "Argus needs at least one active administrator."
        )
    if "display_name" in changes and changes["display_name"]:
        user.display_name = changes["display_name"].strip()
    if "email" in changes:
        user.email = str(changes["email"]) if changes["email"] else None
    if "role" in changes and changes["role"]:
        user.role = changes["role"]
    if "is_active" in changes and changes["is_active"] is not None:
        user.is_active = changes["is_active"]
        if not user.is_active:
            await _end_sessions(db, user.id)
    await audit(
        db,
        "users.update",
        session.user_id,
        client_ip(request),
        target=user.id,
        **{k: str(v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/api/admin/users/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    request: Request,
    db: DbDep,
    session: ManageDep,
):
    """A new temporary password; the user is signed out everywhere."""
    user = await _get(db, user_id)
    if user.id == session.user_id:
        raise HTTPException(
            409, "Change your own password under Account instead."
        )
    temp = new_temp_password()
    user.password_hash = hash_password(temp)
    user.must_change_password = True
    user.failed_logins = 0
    user.locked_until = None
    await _end_sessions(db, user.id)
    await audit(
        db,
        "users.reset_password",
        session.user_id,
        client_ip(request),
        target=user.id,
    )
    await db.commit()
    return {"temporary_password": temp}


@router.post("/api/admin/users/{user_id}/unlock", response_model=AdminUserOut)
async def unlock_user(
    user_id: int,
    request: Request,
    db: DbDep,
    session: ManageDep,
):
    user = await _get(db, user_id)
    user.failed_logins = 0
    user.locked_until = None
    await audit(
        db, "users.unlock", session.user_id, client_ip(request), target=user.id
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.delete(
    "/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_user(
    user_id: int,
    request: Request,
    db: DbDep,
    session: ManageDep,
) -> Response:
    user = await _get(db, user_id)
    if user.id == session.user_id:
        raise HTTPException(409, "You can't delete your own account.")
    if (
        user.role == "admin"
        and user.is_active
        and await _active_admins(db, excluding=user.id) == 0
    ):
        raise HTTPException(
            409, "Argus needs at least one active administrator."
        )
    await audit(
        db,
        "users.delete",
        session.user_id,
        client_ip(request),
        target=user.id,
        username=user.username,
    )
    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- your own account ------------------------------------------------------


@router.post("/api/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChange,
    request: Request,
    session: SessionDep,
    db: DbDep,
) -> Response:
    """Change your password; your other sessions are signed out."""
    user = await db.get(User, session.user_id)
    if not can(user.role, "account.edit") and not user.must_change_password:
        raise HTTPException(
            403, "An administrator manages this account's password."
        )
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(403, "Your current password is wrong.")
    if body.new_password == body.current_password:
        raise HTTPException(422, "Choose a password you haven't just used.")
    problem = password_problem(body.new_password, user.username)
    if problem:
        raise HTTPException(422, problem)
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.password_changed_at = utcnow()
    await _end_sessions(db, user.id, keep=session.id)
    await audit(db, "auth.password_changed", user.id, client_ip(request))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/api/me/profile", response_model=UserOut)
async def update_profile(
    body: ProfileUpdate, request: Request, session: SessionDep, db: DbDep
):
    user = await db.get(User, session.user_id)
    if not can(user.role, "account.edit"):
        raise HTTPException(403, "An administrator manages this account.")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("display_name"):
        user.display_name = changes["display_name"].strip()
    if "email" in changes:
        user.email = str(changes["email"]) if changes["email"] else None
    await audit(db, "account.profile", user.id, client_ip(request))
    await db.commit()
    await db.refresh(user)
    return user
