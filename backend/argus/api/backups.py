"""Backups from the web UI (admins, with their password): download a
backup, restore one, and the restore's progress (argus/backup.py).

POST /api/admin/backup              {password} -> the archive
POST /api/admin/backup/restore      the archive as the body, with
                                    X-Argus-Password and
                                    X-Argus-Confirm: restore
GET  /api/backup/restore/status     {state, message}: readable signed
                                    out, because a restore replaces the
                                    accounts (no details, no secrets)
"""

import asyncio
import os
import signal
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

from argus import backup
from argus.api.deps import DbDep, client_ip, require
from argus.models import User, UserSession
from argus.security import verify_password
from argus.services import audit

router = APIRouter(tags=["backups"])
ManageBackups = Depends(require("backups.manage"))
RESTART_AFTER_S = 1.0


async def _check_password(db, session: UserSession, password: str) -> User:
    user = await db.get(User, session.user_id)
    if user is None or not verify_password(user.password_hash, password):
        raise HTTPException(403, "That password isn't right.")
    return user


class BackupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)


@router.post("/api/admin/backup")
async def download_backup(
    body: BackupIn,
    request: Request,
    db: DbDep,
    session: UserSession = ManageBackups,
):
    """A full backup (database and secret key) as a .tar.gz."""
    if not request.app.state.login_limiter.allow(
        "backup:" + (client_ip(request) or "?")
    ):
        raise HTTPException(429, "Too many attempts. Wait a few minutes.")
    await _check_password(db, session, body.password)
    settings = request.app.state.settings
    try:
        path = await backup.create_archive(
            settings.database_url, settings.secret_key
        )
    except backup.BackupError as exc:
        raise HTTPException(500, str(exc)) from exc
    await audit(db, "backup.downloaded", session.user_id, client_ip(request))
    await db.commit()
    return FileResponse(
        path,
        media_type="application/gzip",
        filename="argus-backup-{0}.tar.gz".format(
            datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        ),
        background=BackgroundTask(lambda: path.unlink(missing_ok=True)),
    )


async def _restore_then_restart(request: Request, path: Path) -> None:
    settings = request.app.state.settings
    try:
        manifest = await backup.restore_archive(
            settings.database_url, settings.secret_key, path
        )
        backup.write_status(
            "done",
            "Restored the backup from {0}. Argus is restarting.".format(
                manifest.get("created_utc", "?")
            ),
        )
    except Exception as exc:  # noqa: BLE001 - tell the admin, keep running
        backup.write_status("failed", str(exc)[:500])
        return
    finally:
        path.unlink(missing_ok=True)
    # A clean start: in-memory caches and sessions belong to the old data,
    # and the API runs any newer migrations as it starts.
    await asyncio.sleep(RESTART_AFTER_S)
    os.kill(os.getpid(), signal.SIGTERM)


@router.post("/api/admin/backup/restore", status_code=202)
async def restore_backup(
    request: Request,
    db: DbDep,
    session: UserSession = ManageBackups,
):
    """Replace all data with an uploaded backup. Checked first, restored
    in the background; poll /api/backup/restore/status."""
    if request.headers.get("x-argus-confirm") != "restore":
        raise HTTPException(400, "Confirm the restore first.")
    await _check_password(
        db, session, request.headers.get("x-argus-password", "")
    )
    if backup.read_status().get("state") == "running":
        raise HTTPException(409, "A restore is already running.")
    fd, name = tempfile.mkstemp(prefix="argus-upload-", suffix=".tar.gz")
    path = Path(name)
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > backup.MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "The backup is too large.")
                out.write(chunk)
        # Check it before anything is touched.
        with tempfile.TemporaryDirectory() as check:
            manifest = backup.unpack(path, Path(check))["manifest"]
    except backup.BackupError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    await audit(
        db,
        "backup.restore_started",
        session.user_id,
        client_ip(request),
        backup_created=manifest.get("created_utc"),
    )
    await db.commit()
    backup.write_status("running", "Restoring the backup…")
    asyncio.create_task(_restore_then_restart(request, path))
    return {"state": "running", "manifest": manifest}


@router.get("/api/backup/restore/status")
async def restore_status():
    s = backup.read_status()
    return {"state": s.get("state", "idle"), "message": s.get("message", "")}
