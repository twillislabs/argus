"""Satellites: the catalogue for the browser to propagate, and details."""

import json

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import func, select

from argus import space
from argus.api.deps import DbDep, SessionDep
from argus.models import Satellite

router = APIRouter(tags=["space"])


@router.get("/api/satellites")
async def list_satellites(
    request: Request, response: Response, session: SessionDep, db: DbDep
):
    """Every catalogued satellite as compact arrays (see space.compact).

    About 17,000 objects; the body is cached in memory until the
    catalogue changes and compresses well (nginx gzips it).
    """
    latest = (
        await db.execute(select(func.max(Satellite.updated_at)))
    ).scalar_one_or_none()
    stamp = latest.isoformat() if latest else ""
    cache = getattr(request.app.state, "satellite_cache", None)
    if not cache or cache[0] != stamp:
        rows = await space.catalog(db)
        body = json.dumps(
            {
                "updated": stamp or None,
                "fields": [
                    "norad",
                    "name",
                    "cospar",
                    "class",
                    "tags",
                    "epoch",
                    "mean_motion",
                    "eccentricity",
                    "inclination",
                    "raan",
                    "arg_perigee",
                    "mean_anomaly",
                    "bstar",
                    "ndot",
                    "nddot",
                ],
                "satellites": [space.compact(s) for s in rows],
            },
            separators=(",", ":"),
        )
        cache = (stamp, body)
        request.app.state.satellite_cache = cache
    etag = '"sat-{0}"'.format(stamp)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(
        cache[1],
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, no-cache"},
    )


@router.get("/api/satellites/{norad_id}")
async def get_satellite(norad_id: int, session: SessionDep, db: DbDep):
    s = await db.get(Satellite, norad_id)
    if s is None:
        raise HTTPException(404, "No satellite with that NORAD id.")
    return {
        "norad": s.norad_id,
        "name": s.name,
        "cospar": s.object_id,
        "class": s.orbit_class,
        "tags": s.tags,
        "epoch": s.epoch.isoformat(),
        "orbit": space.orbit_numbers(s.omm),
        "omm": s.omm,
    }
