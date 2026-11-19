"""Backups from the web UI, in the same archive format as
scripts/backup.sh: a directory holding argus.dump (pg_dump -Fc),
manifest.json and env (here only ARGUS_SECRET_KEY, which decrypts the
stored data-source keys), tarred and gzipped.

Restoring never touches the live database until the backup has been
restored in full into a fresh one (argus_restore); then the two are
swapped and the old one dropped. Stored secrets are re-encrypted from the
backup's secret key to this server's, so an archive moves between
servers. The API then restarts itself (Docker brings it back), running
any newer migrations as it starts.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import make_url

from argus import __version__, secrets

log = logging.getLogger("argus.backup")

STATUS_FILE = Path(tempfile.gettempdir()) / "argus-restore-status.json"
MAX_UPLOAD_BYTES = 2 * 1024**3
NAMES = {"argus.dump", "manifest.json", "env"}


class BackupError(Exception):
    """Something the admin should be told."""


def pg_env(database_url: str, database: str | None = None) -> dict:
    """Environment for pg_dump / psql / pg_restore from the app's URL."""
    url = make_url(database_url)
    env = dict(os.environ)
    env.update(
        PGHOST=url.host or "db",
        PGPORT=str(url.port or 5432),
        PGUSER=url.username or "argus",
        PGPASSWORD=url.password or "",
        PGDATABASE=database or url.database or "argus",
    )
    return env


async def _run(args: list[str], env: dict, stdin=None) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args,
        env=env,
        stdin=stdin,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise BackupError(
            "{0} failed: {1}".format(args[0], err.decode()[-600:].strip())
        )
    return out.decode()


async def create_archive(database_url: str, secret_key: str) -> Path:
    """Write a backup archive to a temporary file and return its path
    (the caller deletes it)."""
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    name = "argus-web-{0}".format(stamp)
    work = Path(tempfile.mkdtemp(prefix="argus-backup-"))
    try:
        folder = work / name
        folder.mkdir()
        env = pg_env(database_url)
        await _run(
            ["pg_dump", "-Fc", "-f", str(folder / "argus.dump")], env=env
        )
        revision = (
            await _run(
                [
                    "psql",
                    "-At",
                    "-c",
                    "select version_num from alembic_version",
                ],
                env=env,
            )
        ).strip()
        (folder / "env").write_text(
            "ARGUS_SECRET_KEY={0}\n".format(secret_key)
        )
        manifest = {
            "app": "argus",
            "version": __version__,
            "schema_revision": revision or "unknown",
            "created_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "includes_env": True,
            "env_has": ["ARGUS_SECRET_KEY"],
            "database_bytes": (folder / "argus.dump").stat().st_size,
            "made_by": "web",
        }
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2))
        fd, archive = tempfile.mkstemp(prefix="argus-", suffix=".tar.gz")
        os.close(fd)
        os.chmod(archive, 0o600)
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(folder, arcname=name)
        return Path(archive)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def unpack(archive: Path, into: Path) -> dict:
    """Check and extract an archive; returns {dump, manifest, secret_key}.
    Only the expected files, one folder deep, are accepted."""
    try:
        with tarfile.open(archive, "r:gz") as tar:
            members = _checked(tar)
            tar.extractall(into, members=members, filter="data")
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise BackupError("That file isn't an Argus backup.") from exc
    return _parts(into, members)


def _checked(tar: tarfile.TarFile) -> list[tarfile.TarInfo]:
    """The archive's files, if they're only what a backup holds."""
    members = [m for m in tar.getmembers() if m.isfile()]
    for m in members:
        parts = Path(m.name).parts
        if len(parts) != 2 or parts[1] not in NAMES or ".." in parts:
            raise BackupError("That file isn't an Argus backup.")
        if m.size > MAX_UPLOAD_BYTES:
            raise BackupError("The backup is too large.")
    return members


def _parts(into: Path, members: list[tarfile.TarInfo]) -> dict:
    found = {Path(m.name).parts[1]: into / m.name for m in members}
    dump = found.get("argus.dump")
    if dump is None or "manifest.json" not in found:
        raise BackupError("That file isn't an Argus backup.")
    try:
        manifest = json.loads(found["manifest.json"].read_text())
    except ValueError as exc:
        raise BackupError("The backup's manifest is damaged.") from exc
    if manifest.get("app") != "argus":
        raise BackupError("That file isn't an Argus backup.")
    key = None
    if "env" in found:
        m = re.search(
            r"^ARGUS_SECRET_KEY=(.*)$", found["env"].read_text(), re.MULTILINE
        )
        key = m.group(1).strip() if m else None
    return {"dump": dump, "manifest": manifest, "secret_key": key}


def reencrypt(value, old_key: str, new_key: str):
    """Every string in a settings value that decrypts with old_key,
    encrypted again with new_key (the rest unchanged)."""
    if isinstance(value, dict):
        return {k: reencrypt(v, old_key, new_key) for k, v in value.items()}
    if isinstance(value, list):
        return [reencrypt(v, old_key, new_key) for v in value]
    if isinstance(value, str) and len(value) > 40:
        plain = secrets.decrypt(old_key, value)
        if plain is not None:
            return secrets.encrypt(new_key, plain)
    return value


def write_status(state: str, message: str = "") -> None:
    STATUS_FILE.write_text(
        json.dumps(
            {
                "state": state,
                "message": message,
                "at": datetime.now(UTC).isoformat(),
            }
        )
    )


def read_status() -> dict:
    try:
        return json.loads(STATUS_FILE.read_text())
    except (OSError, ValueError):
        return {"state": "idle", "message": ""}


async def restore_archive(
    database_url: str, secret_key: str, archive: Path
) -> dict:
    """Restore into argus_restore, swap it in, re-encrypt secrets. Returns
    the manifest. The live database is untouched if anything fails
    before the swap."""
    from argus.db import Database
    from argus.models import ServerSetting

    live = make_url(database_url).database or "argus"
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,40}", live):
        raise BackupError("The database name isn't one this can restore.")
    fresh = live + "_restore"
    old = live + "_old"
    admin = pg_env(database_url, "postgres")
    work = Path(tempfile.mkdtemp(prefix="argus-restore-"))
    try:
        parts = unpack(archive, work)
        await _run(
            [
                "psql",
                "-v",
                "ON_ERROR_STOP=1",
                "-q",
                "-c",
                'DROP DATABASE IF EXISTS "{0}" WITH (FORCE)'.format(fresh),
                "-c",
                'CREATE DATABASE "{0}"'.format(fresh),
            ],
            env=admin,
        )
        try:
            await _run(
                [
                    "pg_restore",
                    "--no-owner",
                    "--exit-on-error",
                    "-d",
                    fresh,
                    str(parts["dump"]),
                ],
                env=pg_env(database_url, fresh),
            )
        except BackupError:
            await _run(
                [
                    "psql",
                    "-q",
                    "-c",
                    'DROP DATABASE IF EXISTS "{0}" WITH (FORCE)'.format(fresh),
                ],
                env=admin,
            )
            raise
        # Re-encrypt stored secrets for this server, in the new database.
        old_key = parts["secret_key"]
        if old_key and old_key != secret_key:
            url = make_url(database_url).set(database=fresh)
            db = Database(url.render_as_string(hide_password=False))
            try:
                async with db.sessionmaker() as session:
                    for row in (
                        await session.execute(select(ServerSetting))
                    ).scalars():
                        value = reencrypt(row.value, old_key, secret_key)
                        if value != row.value:
                            row.value = value
                    await session.commit()
            finally:
                await db.dispose()
        # Swap, as one transaction (several statements in one -c are):
        # end the connections to the live database and rename both, or
        # nothing. Apps reconnecting in between make it fail; try again.
        await _run(
            [
                "psql",
                "-q",
                "-c",
                'DROP DATABASE IF EXISTS "{0}" WITH (FORCE)'.format(old),
            ],
            env=admin,
        )
        # Names checked above ([a-z0-9_]), so formatting them in is safe.
        swap = (  # noqa: S608
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = '{live}' AND pid <> pg_backend_pid(); "
            'ALTER DATABASE "{live}" RENAME TO "{old}"; '
            'ALTER DATABASE "{fresh}" RENAME TO "{live}";'
        ).format(live=live, old=old, fresh=fresh)
        for attempt in range(8):
            try:
                await _run(
                    ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-c", swap],
                    env=admin,
                )
                break
            except BackupError:
                if attempt == 7:
                    raise
                await asyncio.sleep(0.5)
        await _run(
            [
                "psql",
                "-q",
                "-c",
                'DROP DATABASE IF EXISTS "{0}" WITH (FORCE)'.format(old),
            ],
            env=admin,
        )
        return parts["manifest"]
    finally:
        shutil.rmtree(work, ignore_errors=True)
