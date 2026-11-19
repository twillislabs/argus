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

Each screen's wall settings (tour, layers, news, clocks) are its display
account's "wall" preference; admins read and set them through
/api/admin/displays/{id}/wall, and the screen re-reads /api/me each
minute.

Pushing changes: a screen asks /api/display/sync every 10 seconds.
Saving a screen's settings or a profile, or Sync now / Reload in
Settings > Displays, bumps a counter (for one screen or all of them);
the screen re-reads its settings, or reloads the page, when its counter
moves. The counters live in API memory with a boot id, so a restart
just sets a new baseline.
"""

import secrets as pysecrets
import time
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select

from argus.api.deps import (
    DbDep,
    SessionDep,
    SettingsDep,
    client_ip,
    require,
    set_session_cookies,
)
from argus.db import utcnow
from argus.models import ServerSetting, User, UserPreferences, UserSession
from argus.schemas import HomeLocation, WallPrefs, WallProfileIn
from argus.security import hash_password, new_token, token_digest
from argus.services import audit, create_session

router = APIRouter(tags=["displays"])
ManageUsers = Depends(require("users.manage"))

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
CODE_LEN = 6
PAIR_TTL_S = 600
MAX_PENDING = 50


BOOT_ID = pysecrets.token_hex(6)


def _signals(request: Request) -> dict:
    state = request.app.state
    if not hasattr(state, "wall_sync"):
        state.wall_sync = {}
    return state.wall_sync


def push_sync(request: Request, user_id: int | None, reload: bool = False):
    """Ask one screen (user_id) or every screen (None) to sync now."""
    sig = _signals(request).setdefault(
        user_id or "all", {"sync": 0, "reload": 0}
    )
    sig["sync"] += 1
    if reload:
        sig["reload"] += 1


class SyncIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reload: bool = False


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


async def _screen(db, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None or user.role != "display":
        raise HTTPException(404, "No screen with that id.")
    return user


class ScreenWallIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wall: WallPrefs
    # Follow a wall profile instead of the screen's own settings.
    profile: str | None = Field(default=None, max_length=40)
    # The screen's home: its home tour stop, clock and night dimming.
    home: HomeLocation | None = None


@router.get("/api/admin/displays/{user_id}/wall", dependencies=[ManageUsers])
async def get_wall(user_id: int, db: DbDep):
    """A screen's wall settings ({} means the built-in wall) and home."""
    await _screen(db, user_id)
    prefs = await db.get(UserPreferences, user_id)
    data = (prefs.data or {}) if prefs else {}
    return {
        "wall": data.get("wall") or {},
        "home": data.get("home"),
        "profile": data.get("wall_profile"),
    }


@router.put("/api/admin/displays/{user_id}/wall")
async def set_wall(
    user_id: int,
    body: ScreenWallIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    """Replace a screen's wall settings and home."""
    user = await _screen(db, user_id)
    prefs = await db.get(UserPreferences, user_id)
    if prefs is None:
        prefs = UserPreferences(user_id=user_id, data={})
        db.add(prefs)
    wall = body.wall.model_dump(exclude_none=True)
    home = body.home.model_dump() if body.home else None
    if body.profile and body.profile not in await profiles_by_id(db):
        raise HTTPException(404, "No wall profile with that id.")
    data = dict(prefs.data or {})
    for key, value in (
        ("wall", wall),
        ("home", home),
        ("wall_profile", body.profile),
    ):
        if value:
            data[key] = value
        else:
            data.pop(key, None)
    prefs.data = data
    await audit(
        db,
        "display.wall",
        user_id=session.user_id,
        ip=client_ip(request),
        display=user.id,
    )
    await db.commit()
    push_sync(request, user_id)
    return {"wall": wall, "home": home, "profile": body.profile}


@router.get("/api/display/sync")
async def sync_state(request: Request, session: SessionDep):
    """What a wall polls: counters that move when it should sync."""
    sig = _signals(request)
    mine = sig.get(session.user_id) or {}
    every = sig.get("all") or {}
    return {
        "boot": BOOT_ID,
        "sync": mine.get("sync", 0) + every.get("sync", 0),
        "reload": mine.get("reload", 0) + every.get("reload", 0),
    }


@router.post("/api/admin/displays/sync")
async def sync_all(
    body: SyncIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    """Every screen re-reads its settings now (or reloads the page)."""
    push_sync(request, None, body.reload)
    await audit(
        db, "display.sync", user_id=session.user_id,
        ip=client_ip(request), reload=body.reload,
    )  # fmt: skip
    await db.commit()
    return {"ok": True}


@router.post("/api/admin/displays/{user_id}/sync")
async def sync_one(
    user_id: int,
    body: SyncIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    user = await _screen(db, user_id)
    push_sync(request, user.id, body.reload)
    await audit(
        db, "display.sync", user_id=session.user_id,
        ip=client_ip(request), display=user.id, reload=body.reload,
    )  # fmt: skip
    await db.commit()
    return {"ok": True}


# --- Wall profiles: named setups screens can follow -----------------------

PROFILES = "wall_profiles"


async def _profiles_row(db) -> ServerSetting:
    row = await db.get(ServerSetting, PROFILES)
    if row is None:
        row = ServerSetting(key=PROFILES, value={"profiles": []})
        db.add(row)
    return row


async def profiles_by_id(db) -> dict[str, dict]:
    row = await db.get(ServerSetting, PROFILES)
    items = ((row.value or {}).get("profiles") or []) if row else []
    return {p["id"]: p for p in items}


async def _following(db) -> dict[str, int]:
    """How many screens follow each profile."""
    rows = (
        await db.execute(
            select(UserPreferences).join(User).where(User.role == "display")
        )
    ).scalars()
    counts: dict[str, int] = {}
    for r in rows:
        pid = (r.data or {}).get("wall_profile")
        if pid:
            counts[pid] = counts.get(pid, 0) + 1
    return counts


@router.get("/api/admin/wall-profiles", dependencies=[ManageUsers])
async def list_profiles(db: DbDep):
    counts = await _following(db)
    return {
        "profiles": [
            {**p, "screens": counts.get(p["id"], 0)}
            for p in (await profiles_by_id(db)).values()
        ]
    }


@router.post("/api/admin/wall-profiles")
async def create_profile(
    body: WallProfileIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    row = await _profiles_row(db)
    items = list((row.value or {}).get("profiles") or [])
    if len(items) >= 50:
        raise HTTPException(409, "That's the most wall profiles Argus keeps.")
    profile = {
        "id": pysecrets.token_hex(4),
        "name": body.name.strip(),
        "wall": body.wall.model_dump(exclude_none=True),
    }
    row.value = {"profiles": items + [profile]}
    row.updated_at = utcnow()
    await audit(
        db, "wall.profile_created", user_id=session.user_id,
        ip=client_ip(request), profile=profile["id"],
    )  # fmt: skip
    await db.commit()
    return profile


@router.put("/api/admin/wall-profiles/{profile_id}")
async def update_profile(
    profile_id: str,
    body: WallProfileIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    row = await _profiles_row(db)
    items = list((row.value or {}).get("profiles") or [])
    for i, p in enumerate(items):
        if p["id"] == profile_id:
            items[i] = {
                "id": profile_id,
                "name": body.name.strip(),
                "wall": body.wall.model_dump(exclude_none=True),
            }
            row.value = {"profiles": items}
            row.updated_at = utcnow()
            await audit(
                db, "wall.profile_updated", user_id=session.user_id,
                ip=client_ip(request), profile=profile_id,
            )  # fmt: skip
            await db.commit()
            push_sync(request, None)
            return items[i]
    raise HTTPException(404, "No wall profile with that id.")


@router.delete("/api/admin/wall-profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    request: Request,
    db: DbDep,
    session: UserSession = ManageUsers,
):
    """Delete a profile; screens that followed it use their own settings."""
    row = await _profiles_row(db)
    items = list((row.value or {}).get("profiles") or [])
    if not any(p["id"] == profile_id for p in items):
        raise HTTPException(404, "No wall profile with that id.")
    row.value = {"profiles": [p for p in items if p["id"] != profile_id]}
    row.updated_at = utcnow()
    for prefs in (await db.execute(select(UserPreferences))).scalars():
        if (prefs.data or {}).get("wall_profile") == profile_id:
            data = dict(prefs.data)
            data.pop("wall_profile", None)
            prefs.data = data
    await audit(
        db, "wall.profile_deleted", user_id=session.user_id,
        ip=client_ip(request), profile=profile_id,
    )  # fmt: skip
    await db.commit()
    push_sync(request, None)
    return {"ok": True}


@router.get("/api/wall-profiles")
async def profiles_for_everyone(session: SessionDep, db: DbDep):
    """Names and ids, for opening /wall?profile=..."""
    return {
        "profiles": [
            {"id": p["id"], "name": p["name"]}
            for p in (await profiles_by_id(db)).values()
        ]
    }


@router.get("/api/wall-profiles/{profile_id}")
async def profile_for_everyone(
    profile_id: str, session: SessionDep, db: DbDep
):
    p = (await profiles_by_id(db)).get(profile_id)
    if p is None:
        raise HTTPException(404, "No wall profile with that id.")
    return p
