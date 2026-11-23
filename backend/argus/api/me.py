"""The signed-in user and their preferences."""

from fastapi import APIRouter

from argus.api.deps import DbDep, SessionDep
from argus.api.themes import custom_themes
from argus.models import ServerSetting, User, UserPreferences
from argus.schemas import MeOut, Preferences, UserOut

router = APIRouter(tags=["me"])


async def _prefs(db: DbDep, user: User) -> UserPreferences:
    prefs = await db.get(UserPreferences, user.id)
    if prefs is None:
        prefs = UserPreferences(user_id=user.id, data={})
        db.add(prefs)
    return prefs


async def _defaults(db: DbDep) -> dict:
    row = await db.get(ServerSetting, "defaults")
    return dict(row.value or {}) if row else {}


async def _with_profile(db: DbDep, data: dict) -> dict:
    """A screen that follows a wall profile gets the profile's settings as
    its wall (and the profile's name)."""
    pid = data.get("wall_profile")
    if not pid:
        return data
    from argus.api.displays import profiles_by_id

    profile = (await profiles_by_id(db)).get(pid)
    if profile is None:
        return data
    return {
        **data,
        "wall": profile.get("wall") or {},
        "wall_profile_name": profile.get("name"),
    }


async def _channels(db) -> list[dict]:
    from argus import newsconfig

    return [c for c in await newsconfig.channels(db) if c["enabled"]]


@router.get("/api/me", response_model=MeOut)
async def me(session: SessionDep, db: DbDep) -> MeOut:
    user = await db.get(User, session.user_id)
    prefs = await _prefs(db, user)
    return MeOut(
        user=UserOut.model_validate(user),
        preferences=await _with_profile(db, prefs.data or {}),
        defaults=await _defaults(db),
        channels=await _channels(db),
        themes=await custom_themes(db),
    )


@router.patch("/api/me/preferences", response_model=MeOut)
async def update_preferences(
    body: Preferences, session: SessionDep, db: DbDep
) -> MeOut:
    """Merge the given keys into the stored preferences.

    Send a key with null to clear it (for example {"home": null}).
    """
    user = await db.get(User, session.user_id)
    prefs = await _prefs(db, user)
    merged = dict(prefs.data or {})
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    prefs.data = merged
    await db.commit()
    return MeOut(
        user=UserOut.model_validate(user),
        preferences=merged,
        defaults=await _defaults(db),
        channels=await _channels(db),
        themes=await custom_themes(db),
    )
