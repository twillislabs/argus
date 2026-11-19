"""Pairing wall screens without typing a password on them.

1. The screen opens /pair, which calls POST /api/display/pair/start and
   shows the 6-character code it gets back (with a secret token it keeps).
2. An admin enters the code in Settings > Displays. That creates a
   display-role account for the screen and approves the pairing.
3. The screen polls POST /api/display/pair/poll with its token. Once
   approved, the response signs it in (a long-lived session, like
   "remember me") and the screen goes to /wall.

Pairings live in API memory for ten minutes. Unpairing a screen disables
its account and ends its sessions, so nothing on the device keeps working.
"""

import secrets as pysecrets
import time
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select

from argus.api.deps import (
    DbDep,
    SettingsDep,
    client_ip,
    require,
    set_session_cookies,
)
from argus.db import utcnow
from argus.models import User, UserSession
from argus.security import hash_password, new_token, token_digest
from argus.services import audit, create_session

router = APIRouter(tags=["displays"])
ManageUsers = Depends(require("users.manage"))

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
CODE_LEN = 6
PAIR_TTL_S = 600
MAX_PENDING = 50


@dataclass
class Pairing:
    token_digest: str
    created: float
    user_id: int | None = None


def _store(request: Request) -> dict[str, Pairing]:
    state = request.app.state
    if not hasattr(state, "pairings"):
        state.pairings = {}
    now = time.monotonic()
    for code, p in list(state.pairings.items()):
        if now - p.created > PAIR_TTL_S:
            del state.pairings[code]
    return state.pairings


def _new_code(taken: dict) -> str:
    while True:
        code = "".join(pysecrets.choice(ALPHABET) for _ in range(CODE_LEN))
        if code not in taken:
            return code


@router.post("/api/display/pair/start")
async def pair_start(request: Request):
    """A screen asks for a pairing code (no account needed)."""
    ip = client_ip(request) or "unknown"
    if not request.app.state.login_limiter.allow("pair:" + ip):
        raise HTTPException(429, "Too many pairing requests. Wait a minute.")
    store = _store(request)
    if len(store) >= MAX_PENDING:
        raise HTTPException(429, "Too many screens waiting to pair.")
    token = new_token()
    code = _new_code(store)
    store[code] = Pairing(token_digest(token), time.monotonic())
    return {"code": code, "token": token, "expires_in": PAIR_TTL_S}


class PollIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=10, max_length=200)


@router.post("/api/display/pair/poll")
async def pair_poll(
    body: PollIn,
    request: Request,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
):
    """The screen checks whether an admin has approved its code."""
    store = _store(request)
    digest = token_digest(body.token)
    found = next(
        ((c, p) for c, p in store.items() if p.token_digest == digest), None
    )
    if found is None:
        raise HTTPException(410, "This code has expired. Start again.")
    code, pairing = found
    if pairing.user_id is None:
        return {"status": "waiting"}
    user = await db.get(User, pairing.user_id)
    del store[code]
    if user is None or not user.is_active:
        raise HTTPException(410, "This pairing was cancelled.")
    token, session = await create_session(
        db,
        user,
        settings,
        remember=True,
        user_agent=request.headers.get("user-agent"),
        ip=client_ip(request),
    )
    user.last_login_at = utcnow()
    await audit(db, "display.paired", user_id=user.id, ip=client_ip(request))
    await db.commit()
    set_session_cookies(response, token, session, settings)
    return {"status": "paired", "name": user.display_name}


class ApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=CODE_LEN, max_length=CODE_LEN + 2)
    name: str = Field(min_length=1, max_length=80)


def _display(u: User, last_seen) -> dict:
    return {
        "id": u.id,
        "name": u.display_name,
        "username": u.username,
        "active": u.is_active,
        "paired_at": u.created_at.isoformat(),
        "last_seen": last_seen.isoformat() if last_seen else None,
    }


@router.post("/api/admin/displays")
async def approve(
    body: ApproveIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    """An admin enters a screen's code: create its display account and
    approve the pairing."""
    code = body.code.strip().upper().replace("-", "").replace(" ", "")
    pairing = _store(request).get(code)
    if pairing is None:
        raise HTTPException(
            404, "No screen is showing that code. Check it, or start again."
        )
    if pairing.user_id is not None:
        raise HTTPException(409, "That code has already been used.")
    username = "display-" + pysecrets.token_hex(3)
    user = User(
        username=username,
        display_name=body.name.strip(),
        role="display",
        # Nobody signs in with this password; the screen pairs instead.
        password_hash=hash_password(new_token()),
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    pairing.user_id = user.id
    await audit(
        db,
        "display.approved",
        user_id=session.user_id,
        ip=client_ip(request),
        display=user.id,
        name=user.display_name,
    )
    await db.commit()
    return _display(user, None)


@router.get("/api/admin/displays", dependencies=[ManageUsers])
async def list_displays(db: DbDep):
    users = (
        (
            await db.execute(
                select(User)
                .where(User.role == "display")
                .order_by(User.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    seen = dict(
        (
            await db.execute(
                select(UserSession.user_id, func.max(UserSession.last_seen_at))
                .where(UserSession.user_id.in_([u.id for u in users]))
                .group_by(UserSession.user_id)
            )
        ).all()
    )
    return {"displays": [_display(u, seen.get(u.id)) for u in users]}


@router.delete("/api/admin/displays/{user_id}")
async def unpair(
    user_id: int,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    """Unpair a screen: disable its account and end its sessions."""
    user = await db.get(User, user_id)
    if user is None or user.role != "display":
        raise HTTPException(404, "No screen with that id.")
    user.is_active = False
    await db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    await audit(
        db,
        "display.unpaired",
        user_id=session.user_id,
        ip=client_ip(request),
        display=user.id,
    )
    await db.commit()
    return {"ok": True}
