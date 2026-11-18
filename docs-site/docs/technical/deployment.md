---
title: Deployment and networking
sidebar_position: 8
---

# Deployment and networking

## Ports

| Port | Where | Exposed to host? |
|---|---|---|
| `ARGUS_HTTP_PORT` (default 8080) → `web:80` | nginx | **yes**, the only one |
| `api:8000` | uvicorn | no |
| `db:5432` | PostgreSQL | no |
| `nats:4222`, `nats:8222` | NATS client, monitoring | no |

To reach the database from the host while developing, add a temporary
`ports:` entry or use `docker compose exec db psql -U argus`.

## Behind a reverse proxy (recommended)

Terminate TLS in front of `web`, for example with Caddy:

```text
argus.example.lan {
    reverse_proxy 127.0.0.1:8080
}
```

The API trusts `X-Forwarded-*` from nginx, which sets `X-Forwarded-Proto`
from the request it receives. Keep `ARGUS_COOKIE_SECURE=true` whenever
browsers reach Argus over HTTPS.

## Data and backups

| Volume | Contents |
|---|---|
| `argus_db-data` | PostgreSQL data directory |
| `argus_nats-data` | JetStream storage (safe to lose; it is a buffer) |

Back up the database with:

```bash
docker compose exec -T db pg_dump -U argus -Fc argus > argus-$(date +%F).dump
```

## Health checks

| Service | Check |
|---|---|
| db | `pg_isready -U argus -d argus` |
| api | `GET /api/health` (includes a `SELECT 1`) |
| web | `GET /healthz` |

Compose starts `api` only after `db` is healthy, and `web` only after `api`
is healthy.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Checks |
|---|---|
| backend | ruff lint and format, pytest |
| migrations | `alembic upgrade head`, `alembic check` and `downgrade base` against PostgreSQL |
| frontend | `tsc` type check and production build |
| docs | Docusaurus build (fails on broken links) |
