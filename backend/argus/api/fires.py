"""Wildfire outlines (argus/fireperims.py)."""

from fastapi import APIRouter, Request

from argus.api.deps import SessionDep

router = APIRouter(tags=["fires"])

ATTRIBUTION = "Wildfire perimeters: NIFC WFIGS (public domain)"


@router.get("/api/fires/perimeters")
async def fire_perimeters(request: Request, session: SessionDep):
    found = await request.app.state.fire_perimeters.current()
    return found | {"attribution": ATTRIBUTION}
