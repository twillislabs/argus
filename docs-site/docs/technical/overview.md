---
title: System overview
sidebar_position: 1
---

# System overview

Argus is six containers on one Docker network. Only `web` is published to
the host; everything else is reachable only from inside the network.

```mermaid
flowchart LR
  subgraph host[Your machine or server]
    subgraph net[Compose network]
      web["web<br/>nginx :80<br/>app + docs + proxy"]
      api["api<br/>FastAPI / uvicorn :8000"]
      worker["worker<br/>collectors"]
      db[("db<br/>PostgreSQL 17<br/>TimescaleDB + PostGIS")]
      nats[("nats<br/>NATS :4222")]
      tiles["tiles<br/>tileserver-gl"]
    end
  end
  browser["Browser<br/>React + CesiumJS"] -->|"HTTP :8080<br/>(ARGUS_HTTP_PORT)"| web
  web -->|"/api/*, /ws/*"| api
  web -->|"/tiles/"| tiles
  api -->|"SQL (asyncpg)"| db
  worker -->|"SQL"| db
  worker -->|"live aircraft, ships"| nats
  nats --> api
  worker -->|"public sources (HTTPS)"| ext["USGS, GDELT, RSS,<br/>ADS-B, AIS, NWS ..."]
```

| Component | Built from | Talks to | Why it exists |
|---|---|---|---|
| **web** | `frontend/Dockerfile` | `api`, `tiles` | Serves the built React app at `/`, the docs at `/docs/`, and proxies `/api/`, `/ws/` and the street map tiles. It also sets the browser security headers (CSP and friends) and optional TLS. |
| **api** | `backend/Dockerfile` | `db`, `nats`, public sources | Accounts, settings, every layer's endpoints, live updates, on-request lookups (imagery, FAA status, space weather, air-raid alerts, addresses, AI) and the alert checker. It runs migrations on every start. |
| **worker** | `backend/Dockerfile` (`python -m argus.worker`) | `db`, `nats`, public sources | The collectors: events, aircraft, ships, satellites, weather, cameras, launches, cyber and the rest, on their own schedules. |
| **db** | `timescale/timescaledb-ha:pg17` | — | The single source of truth. |
| **nats** | `nats:2.10-alpine` | — | Carries live aircraft, ships and GPS samples from the worker to the API, which keeps them in memory. |
| **tiles** | `maptiler/tileserver-gl` | — | Renders the self-hosted street map from the region you downloaded (`make streetmap`). |

## What happens on `docker compose up`

1. `db` starts and becomes healthy (`pg_isready`).
2. `api` starts after `db` is healthy and runs `alembic upgrade head`, which
   applies any new migrations. Then uvicorn starts the app.
3. On start-up the app checks for users. If there are none, it creates a
   **setup token**, stores only its SHA-256 and prints the token to the log
   ([first-run flow](auth.md#first-run-setup)).
4. `api` reports healthy once `GET /api/health` answers 200.
5. `web` starts after `api` is healthy and serves on `ARGUS_HTTP_PORT`.

## Where things live in the repo

| Path | Runs in | Contents |
|---|---|---|
| `backend/argus/` | api | FastAPI app (see [Backend](backend.md)) |
| `backend/migrations/` | api (start-up) | Alembic migrations |
| `frontend/src/` | browser | React app (see [Frontend](frontend.md)) |
| `frontend/nginx.conf` | web | Routing, proxy and security headers |
| `docs-site/` | web (static) | This documentation |
| `docker-compose.yml` | host | Wiring of the six services |
