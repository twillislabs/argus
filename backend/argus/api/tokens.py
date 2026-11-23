"""API tokens: read-only tokens a user makes for scripts and AI
assistants (the MCP server, api/mcp.py). The token is shown once; only
its SHA-256 is stored.

GET    /api/me/tokens        yours
POST   /api/me/tokens        make one {name}; the answer has the token
DELETE /api/me/tokens/{id}   revoke one
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from argus import access
from argus.api.deps import TOKEN_PREFIX, DbDep, SessionDep
from argus.models import ApiToken
from argus.security import new_token, token_digest

router = APIRouter(tags=["tokens"])

MAX_TOKENS = 10


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _out(t: ApiToken) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "created_at": t.created_at.isoformat(),
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
    }


async def _check(session, db) -> None:
    if session.id.startswith("token:"):
        raise HTTPException(403, "Sign in to manage API tokens.")
    if session.user.role == "display":
        raise HTTPException(403, "Wall screens can't have API tokens.")
    if not await access.may(db, session.user, "api.tokens"):
        raise HTTPException(
            403,
            "API tokens are limited to some groups. Ask an administrator.",
        )


@router.get("/api/me/tokens")
async def list_tokens(session: SessionDep, db: DbDep):
    await _check(session, db)
    rows = await db.scalars(
        select(ApiToken)
        .where(ApiToken.user_id == session.user_id)
        .order_by(ApiToken.created_at)
    )
    return {"tokens": [_out(t) for t in rows]}


@router.post("/api/me/tokens", status_code=201)
async def make_token(body: TokenIn, session: SessionDep, db: DbDep):
    await _check(session, db)
    count = await db.scalar(
        select(func.count())
        .select_from(ApiToken)
        .where(ApiToken.user_id == session.user_id)
    )
    if count >= MAX_TOKENS:
        raise HTTPException(
            409, "You have {0} tokens; revoke one first.".format(MAX_TOKENS)
        )
    token = TOKEN_PREFIX + new_token(32)
    row = ApiToken(
        user_id=session.user_id,
        name=body.name.strip(),
        digest=token_digest(token),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _out(row) | {"token": token}


@router.delete("/api/me/tokens/{token_id}", status_code=204)
async def revoke_token(token_id: int, session: SessionDep, db: DbDep):
    await _check(session, db)
    row = await db.get(ApiToken, token_id)
    if row is None or row.user_id != session.user_id:
        raise HTTPException(404, "No such token.")
    await db.delete(row)
    await db.commit()
