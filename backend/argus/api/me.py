"""The signed-in user and their preferences."""

from fastapi import APIRouter

from argus.api.deps import DbDep, SessionDep
from argus.models import User, UserPreferences
from argus.schemas import MeOut, Preferences, UserOut

router = APIRouter(tags=["me"])


async def _prefs(db: DbDep, user: User) -> UserPreferences:
    prefs = await db.get(UserPreferences, user.id)
    if prefs is None:
        prefs = UserPreferences(user_id=user.id, data={})
        db.add(prefs)
    return prefs


@router.get("/api/me", response_model=MeOut)
async def me(session: SessionDep, db: DbDep) -> MeOut:
    user = await db.get(User, session.user_id)
    prefs = await _prefs(db, user)
    return MeOut(user=UserOut.model_validate(user), preferences=prefs.data)


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
    return MeOut(user=UserOut.model_validate(user), preferences=merged)
