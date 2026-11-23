"""User groups and feature access (argus/access.py), for admins.

GET    /api/admin/groups            groups with their member ids
POST   /api/admin/groups            make one
PUT    /api/admin/groups/{id}       rename, describe, set members
DELETE /api/admin/groups/{id}
GET    /api/admin/access            the limitable features and their rules
PUT    /api/admin/access            set the rules
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select

from argus import access
from argus.api.deps import DbDep, client_ip, require
from argus.db import utcnow
from argus.models import (
    ServerSetting,
    User,
    UserGroup,
    UserGroupMember,
    UserSession,
)
from argus.roles import CAPABILITIES, ROLE_LABELS
from argus.services import audit

router = APIRouter(tags=["groups"])
ManageDep = Annotated[UserSession, Depends(require("users.manage"))]


class GroupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=200)
    members: list[int] = Field(default_factory=list, max_length=2000)


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["role", "only"] = "role"
    groups: list[int] = Field(default_factory=list, max_length=500)
    users: list[int] = Field(default_factory=list, max_length=500)


class AccessIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rules: dict[str, Rule]


async def _members(db) -> dict[int, list[int]]:
    rows = await db.execute(select(UserGroupMember))
    out: dict[int, list[int]] = {}
    for m in rows.scalars():
        out.setdefault(m.group_id, []).append(m.user_id)
    return out


def _out(g: UserGroup, members: list[int]) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "members": sorted(members),
    }


async def _set_members(db, group_id: int, ids: list[int]) -> None:
    known = set(
        (
            await db.execute(select(User.id).where(User.id.in_(set(ids))))
        ).scalars()
    )
    await db.execute(
        delete(UserGroupMember).where(UserGroupMember.group_id == group_id)
    )
    for uid in sorted(known):
        db.add(UserGroupMember(group_id=group_id, user_id=uid))


async def _name_free(db, name: str, but: int | None = None) -> None:
    q = select(UserGroup.id).where(UserGroup.name == name)
    if but is not None:
        q = q.where(UserGroup.id != but)
    if (await db.execute(q)).scalar_one_or_none() is not None:
        raise HTTPException(409, "There's already a group called that.")


@router.get("/api/admin/groups")
async def list_groups(db: DbDep, session: ManageDep):
    members = await _members(db)
    rows = await db.execute(select(UserGroup).order_by(UserGroup.name))
    return {"groups": [_out(g, members.get(g.id, [])) for g in rows.scalars()]}


@router.post("/api/admin/groups", status_code=status.HTTP_201_CREATED)
async def make_group(
    body: GroupIn, request: Request, db: DbDep, session: ManageDep
):
    name = " ".join(body.name.split())
    await _name_free(db, name)
    g = UserGroup(
        name=name, description=(body.description or "").strip() or None
    )
    db.add(g)
    await db.flush()
    await _set_members(db, g.id, body.members)
    await audit(
        db, "groups.create", session.user_id, client_ip(request), target=g.id
    )
    await db.commit()
    access.forget()
    return _out(g, (await _members(db)).get(g.id, []))


@router.put("/api/admin/groups/{group_id}")
async def edit_group(
    group_id: int,
    body: GroupIn,
    request: Request,
    db: DbDep,
    session: ManageDep,
):
    g = await db.get(UserGroup, group_id)
    if g is None:
        raise HTTPException(404, "No such group.")
    name = " ".join(body.name.split())
    await _name_free(db, name, but=group_id)
    g.name = name
    g.description = (body.description or "").strip() or None
    await _set_members(db, g.id, body.members)
    await audit(
        db, "groups.edit", session.user_id, client_ip(request), target=g.id
    )
    await db.commit()
    access.forget()
    return _out(g, (await _members(db)).get(g.id, []))


@router.delete(
    "/api/admin/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_group(
    group_id: int, request: Request, db: DbDep, session: ManageDep
):
    g = await db.get(UserGroup, group_id)
    if g is None:
        raise HTTPException(404, "No such group.")
    await db.execute(
        delete(UserGroupMember).where(UserGroupMember.group_id == group_id)
    )
    await db.delete(g)
    await audit(
        db,
        "groups.delete",
        session.user_id,
        client_ip(request),
        target=group_id,
    )
    await db.commit()
    access.forget()


@router.get("/api/admin/access")
async def get_access(db: DbDep, session: ManageDep):
    rules = await access.rules(db)
    return {
        "features": [
            {
                "id": f,
                "label": label,
                "description": text,
                # Roles that have it at all (limits narrow these).
                "roles": [
                    ROLE_LABELS[r]
                    for r, caps in CAPABILITIES.items()
                    if f in caps
                ],
            }
            for f, (label, text) in access.RESTRICTABLE.items()
        ],
        "rules": {
            f: rules.get(f, {"mode": "role", "groups": [], "users": []})
            for f in access.RESTRICTABLE
        },
    }


@router.put("/api/admin/access")
async def put_access(
    body: AccessIn, request: Request, db: DbDep, session: ManageDep
):
    unknown = set(body.rules) - set(access.RESTRICTABLE)
    if unknown:
        raise HTTPException(
            422,
            "Not a feature that can be limited: {0}".format(
                ", ".join(sorted(unknown))
            ),
        )
    value = access.clean_rules(
        {f: r.model_dump() for f, r in body.rules.items()}
    )
    row = await db.get(ServerSetting, access.KEY)
    if row is None:
        row = ServerSetting(key=access.KEY)
        db.add(row)
    row.value = value
    row.updated_at = utcnow()
    row.updated_by = session.user_id
    await audit(
        db,
        "settings.access",
        session.user_id,
        client_ip(request),
        limited=sorted(f for f, r in value.items() if r["mode"] == "only"),
    )
    await db.commit()
    access.forget()
    return await get_access(db, session)
