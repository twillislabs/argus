"""Air and sea behaviour patterns (argus/patterns.py), for everyone."""

import time

from fastapi import APIRouter, Request

from argus import patterns
from argus.api.deps import DbDep, SessionDep
from argus.models import ServerSetting

router = APIRouter(tags=["patterns"])

TTL_S = 60


async def _cables(request: Request, db) -> patterns.CableIndex | None:
    """The cable index, rebuilt when the worker has fetched new cables."""
    row = await db.get(ServerSetting, "layer:cables")
    if row is None:
        return None
    stamp = (row.value or {}).get("fetched")
    hit = getattr(request.app.state, "cable_index", None)
    if hit and hit[0] == stamp:
        return hit[1]
    index = patterns.CableIndex((row.value or {}).get("cables") or {})
    request.app.state.cable_index = (stamp, index)
    return index


@router.get("/api/patterns")
async def behaviour_patterns(request: Request, session: SessionDep, db: DbDep):
    state = request.app.state
    hit = getattr(state, "patterns_cache", None)
    if hit and time.monotonic() - hit[0] < TTL_S:
        return hit[1]
    body = {
        "air": patterns.air_patterns(state.air),
        "sea": patterns.sea_patterns(state.sea, await _cables(request, db)),
    }
    state.patterns_cache = (time.monotonic(), body)
    return body
