from fastapi import APIRouter
from sqlalchemy import text

from argus import __version__
from argus.api.deps import DbDep
from argus.schemas import Health

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=Health)
async def health(db: DbDep) -> Health:
    try:
        await db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001 - report, don't crash the probe
        database = "unavailable"
    return Health(
        status="ok" if database == "ok" else "degraded",
        version=__version__,
        database=database,
    )
