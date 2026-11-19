import io
import json
import tarfile

import pytest

from argus import backup, secrets
from tests.conftest import PASSWORD, csrf


def make_archive(path, files):
    with tarfile.open(path, "w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def good_files(folder="argus-x"):
    return {
        folder + "/argus.dump": b"PGDMP...",
        folder + "/manifest.json": json.dumps({"app": "argus"}).encode(),
        folder + "/env": b"POSTGRES_PASSWORD=x\nARGUS_SECRET_KEY=old-key\n",
    }


def test_unpack_reads_a_backup(tmp_path):
    make_archive(tmp_path / "b.tar.gz", good_files())
    out = tmp_path / "out"
    out.mkdir()
    parts = backup.unpack(tmp_path / "b.tar.gz", out)
    assert parts["secret_key"] == "old-key"
    assert parts["manifest"]["app"] == "argus"
    assert parts["dump"].read_bytes() == b"PGDMP..."


@pytest.mark.parametrize(
    "files",
    [
        {"argus-x/../../etc/passwd": b"x", **good_files()},
        {"argus-x/extra.sh": b"x", **good_files()},
        {"argus-x/manifest.json": json.dumps({"app": "other"}).encode()},
        {"argus-x/argus.dump": b"x"},
    ],
)
def test_unpack_refuses_anything_else(tmp_path, files):
    make_archive(tmp_path / "b.tar.gz", files)
    out = tmp_path / "out"
    out.mkdir()
    with pytest.raises(backup.BackupError):
        backup.unpack(tmp_path / "b.tar.gz", out)
    assert not (tmp_path / "etc").exists()


def test_unpack_refuses_non_archives(tmp_path):
    (tmp_path / "b.tar.gz").write_bytes(b"not a tarball")
    with pytest.raises(backup.BackupError):
        backup.unpack(tmp_path / "b.tar.gz", tmp_path)


def test_reencrypt_moves_secrets_to_the_new_key():
    token = secrets.encrypt("old-key", "my-api-key")
    value = {
        "aisstream": token,
        "list": [token, "plain"],
        "note": "x" * 50,
    }
    out = backup.reencrypt(value, "old-key", "new-key")
    assert secrets.decrypt("new-key", out["aisstream"]) == "my-api-key"
    assert secrets.decrypt("new-key", out["list"][0]) == "my-api-key"
    assert out["list"][1] == "plain" and out["note"] == "x" * 50


async def test_backup_endpoints_need_the_password(admin_client, client):
    r = await admin_client.post(
        "/api/admin/backup",
        json={"password": "wrong"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 403
    r = await admin_client.post(
        "/api/admin/backup/restore",
        content=b"x",
        headers={
            **csrf(admin_client),
            "X-Argus-Confirm": "restore",
            "X-Argus-Password": "wrong",
        },
    )
    assert r.status_code == 403
    r = await admin_client.post(
        "/api/admin/backup/restore",
        content=b"x",
        headers={**csrf(admin_client), "X-Argus-Password": PASSWORD},
    )
    assert r.status_code == 400  # not confirmed
    r = await admin_client.post(
        "/api/admin/backup/restore",
        content=b"not a backup",
        headers={
            **csrf(admin_client),
            "X-Argus-Confirm": "restore",
            "X-Argus-Password": PASSWORD,
        },
    )
    assert r.status_code == 400
    assert "isn't an Argus backup" in r.json()["detail"]
    # Signed out: no backups, but the restore status is readable.
    assert (
        await client.post("/api/admin/backup", json={"password": "x"})
    ).status_code in (401, 403)
    assert (await client.get("/api/backup/restore/status")).status_code == 200
