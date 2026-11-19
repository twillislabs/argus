---
title: Backups and moving servers
sidebar_position: 4
---

# Backups and moving servers

Two commands, run in the Argus folder on the server:

```bash
make backup
```

writes `backups/argus-<folder>-<date>.tar.gz`: a full dump of the
database (accounts, settings, data-source keys, preferences, drawings,
events, history), the server's `.env`, and a small `manifest.json` (Argus
version, schema revision, time). The archive is written with mode 600:
**it holds secrets** (the database, password hashes, and the `.env` with
the key that decrypts stored data-source keys), so keep it somewhere
safe. `scripts/backup.sh --no-env` leaves `.env` out.

```bash
make restore FILE=backups/argus-argus-20261119-194356.tar.gz
```

replaces **all** of this server's data with the backup (it asks you to
type `restore` first; `scripts/restore.sh --yes` skips that). The API
brings the schema up to date when it starts, so a backup from an older
Argus restores into a newer one.

## Moving to a new server

1. On the old server: `make backup`, and copy the archive across (for
   example with `scp`).
2. On the new one: clone Argus, **don't** run `make up` or `make env`,
   and run `make restore FILE=...`. With no `.env` yet, the backup's is
   used, so the database password, secret key and settings come along,
   and the stack starts.
3. Change anything that differs on the new host in `.env` (for example
   `ARGUS_HTTP_PORT`, `ARGUS_TRUSTED_PROXIES`), then `make up`.

Restoring onto a server that already has an `.env` keeps that file (its
database password belongs to that server's database) but takes
`ARGUS_SECRET_KEY` from the backup, so stored data-source keys still
decrypt; the old file is saved as `.env.before-restore`.

## What isn't in a backup

| | |
|---|---|
| The street map (`data/streetmap/`) | Large and downloadable again: `make streetmap` on the new server |
| NATS (`argus_nats-data`) | A buffer between worker and API; safe to lose |
| nginx's tile cache | Refills by itself |
| Cached areas (plate readers, openAIP, ...) | Refetched as people look around |

Schedule backups with cron, for example nightly at 03:00:

```text
0 3 * * * cd /opt/argus && make backup >/dev/null 2>&1
```

and remove old archives from `backups/` now and then.
