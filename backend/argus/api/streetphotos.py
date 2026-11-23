"""Street-level photos near a spot (argus/streetphotos.py: Mapillary with
an admin's token, and a Google Street View link always).

/api/streetphotos?lat=&lon=     the nearest photos, with credit
/api/streetphotos/image?u=      a photo or thumbnail a search returned
"""

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response

from argus import secrets
from argus.api.deps import DbDep, SessionDep
from argus.models import ServerSetting

router = APIRouter(tags=["streetphotos"])


@router.get("/api/streetphotos")
async def near(
    request: Request,
    session: SessionDep,
    db: DbDep,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    row = await db.get(ServerSetting, "keys")
    stored = (row.value or {}).get("mapillary") if row else None
    token = (
        secrets.decrypt(request.app.state.settings.secret_key, stored)
        if stored
        else None
    )
    return await request.app.state.streetphotos.near(lat, lon, token)


@router.get("/api/streetphotos/image")
async def image(request: Request, session: SessionDep, u: str = Query(...)):
    try:
        got = await request.app.state.streetphotos.image(u)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "The photo didn't load.") from exc
    if got is None:
        raise HTTPException(404, "No such photo.")
    return Response(
        content=got[0],
        media_type=got[1],
        headers={"Cache-Control": "private, max-age=86400"},
    )
