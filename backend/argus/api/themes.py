"""Themes (argus/themes.py): custom themes (admins), and the server's
default theme for pages shown before anyone signs in.

GET /api/theme            public: the server default (an id, and the
                          custom theme's definition when it is one)
GET /api/admin/themes     custom themes
PUT /api/admin/themes     replace them ({"items": [...]})
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from argus import themes
from argus.api.deps import DbDep, client_ip, require
from argus.db import utcnow
from argus.models import ServerSetting, UserSession
from argus.services import audit

router = APIRouter(tags=["themes"])
KEY = "themes"
AdminDep = Depends(require("settings.manage"))


async def custom_themes(db) -> list[dict]:
    row = await db.get(ServerSetting, KEY)
    return list((row.value or {}).get("items") or []) if row else []


async def default_theme(db) -> str:
    row = await db.get(ServerSetting, "defaults")
    chosen = (row.value or {}).get("theme") if row else None
    custom = await custom_themes(db)
    return chosen if themes.known(chosen, custom) else themes.DEFAULT


@router.get("/api/theme")
async def server_theme(db: DbDep):
    """The server's default theme, for the sign-in, setup and pairing
    pages (no session). Public: themes hold only colours and choices."""
    tid = await default_theme(db)
    custom = next((t for t in await custom_themes(db) if t["id"] == tid), None)
    return {"default": tid, "theme": custom}


class ThemesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[dict]


@router.get("/api/admin/themes", dependencies=[AdminDep])
async def get_themes(db: DbDep):
    return {"items": await custom_themes(db), "builtin": themes.BUILTIN}


@router.put("/api/admin/themes")
async def put_themes(
    body: ThemesIn,
    request: Request,
    db: DbDep,
    session: UserSession = AdminDep,
):
    try:
        items = themes.clean_all(body.items)
    except themes.ThemeError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = await db.get(ServerSetting, KEY)
    if row is None:
        row = ServerSetting(key=KEY)
        db.add(row)
    row.value = {"items": items}
    row.updated_at = utcnow()
    row.updated_by = session.user_id
    await audit(
        db,
        "settings.themes",
        session.user_id,
        client_ip(request),
        parts=[t["id"] for t in items],
    )
    await db.commit()
    return {"items": items, "builtin": themes.BUILTIN}
