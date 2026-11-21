"""World radio stations (argus/radio.py, Radio Browser).

/api/radio   stations with a location and an HTTPS stream
"""

from fastapi import APIRouter, Request

from argus.api.deps import SessionDep

router = APIRouter(tags=["radio"])


@router.get("/api/radio")
async def radio(request: Request, session: SessionDep):
    return await request.app.state.radio.stations()
