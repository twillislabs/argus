<p align="center">
  <img src="frontend/public/img/logo.svg" alt="Argus" width="96" height="96">
</p>

<h1 align="center">Argus</h1>

<p align="center">
  The world, live, on your own server
</p>

<p align="center">
  <a href="https://github.com/twillislabs/argus/actions/workflows/ci.yml"><img src="https://github.com/twillislabs/argus/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---

Argus is a self-hosted visualizer for open-source intelligence (OSINT). It brings conflict and
protest reports, earthquakes, fires and the news onto one 3D globe, and will add aircraft, ships,
satellites, airspace, infrastructure, weather and live video. Every marker shows where it came from
and how sure Argus is about it, and the whole thing runs from one `docker compose up` with no paid
keys.

What it does today:

- **A 3D globe and 2D world map** (CesiumJS) that opens at your home location, with NASA imagery
  and no third-party map account.
- **Live events**:
  - earthquakes from USGS every minute
  - conflict and protest reports from GDELT every 15 minutes
  - satellite fire detections from NASA FIRMS (with a free key)

  Events are merged across sources and pushed to the browser as they happen.
- **Corroboration before it hits the map.** Machine-coded GDELT reports start as *unconfirmed* and
  only become events when several independent outlets report them.
- **News from across the spectrum.** Headlines from fifteen outlets, US and international, left
  and right, matched to the events they describe.
- **A situation panel** with counts by type, what's near home, a live feed, headlines and the
  health of every source. Click any event for its sources, coverage and raw record.
- **First-run setup and accounts.**
  - A one-time setup token from the server log
  - Argon2id passwords and sessions with CSRF protection
  - Lockout and rate limiting, plus an audit log
- **Built-in documentation** at `/docs/`, including how every part connects.

What's coming is in the [plan](docs/PLAN.md): aircraft and ships, satellites with live orbits,
street-level imagery, airspace and GPS-jamming, weather, news and traffic video, wall mode for a
watch-floor screen, balanced news coverage, alerts, and optional AI (Anthropic, OpenAI or a local
model).

## Quick start

You need Docker with the Compose plugin and `make`.

```sh
git clone https://github.com/twillislabs/argus.git
cd argus
make up        # writes .env with random secrets, builds and starts everything
make token     # prints the one-time setup token
```

1. Open **http://localhost:8080** and enter the setup token.
2. Create the admin account and pick your home location (any town of 15,000+ people, or
   coordinates).
3. Events start arriving within a minute. Select **Docs** in the header for the rest.

Cookies are `Secure` by default, so plain HTTP needs `ARGUS_COOKIE_SECURE=false` in `.env`. That's
fine on localhost; anywhere else, put Argus behind a TLS reverse proxy such as Caddy. Fire
detections need a free [FIRMS map key](https://firms.modaps.eosdis.nasa.gov/api/map_key/) in
`ARGUS_FIRMS_MAP_KEY`.

## Run it

```sh
make up        # build and start (docker compose up -d --build)
make down      # stop it (data stays in the db-data volume)
make logs      # follow the API and the collector worker
make status    # containers and their health
make           # every target
```

| Service | What it does |
| --- | --- |
| `web` | nginx: serves the app and the docs, proxies `/api` and `/ws`, sets the security headers |
| `api` | FastAPI: accounts, sessions, events, live WebSocket; runs migrations on start |
| `worker` | Collectors (USGS, GDELT, RSS, FIRMS) and event fusion; publishes changes to NATS |
| `db` | PostgreSQL 17 with TimescaleDB and PostGIS |
| `nats` | NATS JetStream message bus between the worker and the API |

Only `web` is published to the host (port `ARGUS_HTTP_PORT`, default 8080).

## The guide

Argus serves its documentation at **`/docs/`**:
- **Getting started:** installing and first-run setup.
- **Administration:** the security model and every setting.
- **Technical:** a section on how it all connects, with diagrams of the request path, sign-in,
  backend, frontend, database, data pipeline and deployment.

Its source is Markdown in [`docs-site/docs/`](docs-site/docs/), built with Docusaurus
(`make docs-dev` for live reload).

## Develop

```sh
make install   # backend (uv), frontend and docs packages
make dev-api   # API with reload on :8000
make dev-web   # Vite on :5173, proxying /api and /ws
make test      # pytest
make lint      # ruff and the TypeScript check
make ci        # everything GitHub Actions runs, locally
```

| Path | What it holds |
| --- | --- |
| `backend/argus/` | The API: settings, models, auth, events, live updates, the place index |
| `backend/argus/collectors/` | One module per data source (USGS, GDELT, RSS, FIRMS) |
| `backend/argus/fusion.py` | Raw records into events: clustering, severity, promotion |
| `backend/argus/worker.py` | The collector scheduler and NATS publisher |
| `backend/migrations/` | Alembic migrations, applied when the API starts |
| `frontend/src/` | The web app: React, TypeScript and CesiumJS (`pages/`, `components/`, `map/`, `lib/`, `styles/`) |
| `docs-site/` | The documentation (Docusaurus), served at `/docs/` |
| `docs/PLAN.md` | The plan and milestones |
| `docs/mockup/` | The interactive design mock (`python3 build.py` builds it) |
| `scripts/ci.sh` | The CI checks, runnable locally |

API docs are at `/api/docs` while Argus is running.

Conventions: Python follows PEP 8 at 79 columns with ruff, and uses `str.format()` for strings.
TypeScript is strict. Commits follow Conventional Commits with 50/72 messages.

## Data and credits

- **Imagery:** NASA GIBS (Blue Marble).
- **Earthquakes:** USGS (public domain).
- **Events:** the GDELT Project.
- **Fires:** NASA FIRMS.
- **Places:** [GeoNames](https://www.geonames.org/) (CC BY 4.0).
- **Globe:** CesiumJS (Apache 2.0).
- **News headlines:** each outlet's own feed. Argus stores only the headline, a short excerpt and
  the link, and always links to the original.
