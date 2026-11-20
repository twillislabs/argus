---
title: Install with Docker Compose
---

# Install with Docker Compose

## Requirements

- Docker Engine 24+ with the Compose plugin
- 4 GB RAM for the core stack
- A modern browser with WebGL 2

## Steps

1. Get the code and create your settings file:

   ```bash
   git clone <your fork>/argus.git
   cd argus
   cp .env.example .env
   ```

2. Edit `.env`. At minimum set `ARGUS_SECRET_KEY` and `POSTGRES_PASSWORD` to
   long random values:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

4. Find the one-time setup token:

   ```bash
   docker compose logs api | grep "setup token"
   ```

5. Open `http://localhost:8080` (or the port in `ARGUS_HTTP_PORT`) and follow
   [first-run setup](first-run.md).

## Services

| Service | Image | Purpose |
|---|---|---|
| `web` | built from `frontend/` | nginx serving the app and these docs, proxying `/api` |
| `api` | built from `backend/` | FastAPI; runs database migrations on start |
| `db` | `timescale/timescaledb-ha:pg17` | PostgreSQL with TimescaleDB and PostGIS |
| `nats` | `nats:2.10-alpine` | Message bus with JetStream (used from milestone 1) |

## Upgrading

```bash
./argus update
```

It refuses if you've changed Argus's files, backs up the database, pulls
the latest code, rebuilds and waits until Argus is healthy again. The API
applies database migrations automatically before it starts. Releases are
tagged (`v1.0.0` and on) with notes on GitHub and in `CHANGELOG.md`; the
account menu shows the version you're running, as does `/api/health`.
