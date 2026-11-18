# Argus

Self-hosted OSINT visualizer: aircraft, ships, satellites, events, airspace,
infrastructure, weather and live video on one map that zooms from the globe
to street level.

**Status:** milestone 0. The Compose stack, first-run setup, sign-in and a 3D
globe that opens at your home location. See [docs/PLAN.md](docs/PLAN.md) for
the full plan and [docs/mockup/](docs/mockup/) for the interactive design mock.

## Quick start

```bash
cp .env.example .env          # then set POSTGRES_PASSWORD and ARGUS_SECRET_KEY
docker compose up -d --build
docker compose logs api | grep "setup token"
```

Open <http://localhost:8080> and enter the setup token. Cookies are `Secure`
by default, so for plain-HTTP testing on localhost set
`ARGUS_COOKIE_SECURE=false` in `.env`. In production, put Argus behind a
TLS-terminating reverse proxy.

Documentation is served at <http://localhost:8080/docs/> (source in
[docs-site/](docs-site/)).

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI API, Alembic migrations, tests |
| `frontend/` | React + CesiumJS web app, nginx config |
| `docs-site/` | Docusaurus documentation |
| `docs/` | Plan and design mock |

## Development

```bash
cd backend && uv sync && uv run pytest
cd frontend && npm install && npm run dev
cd docs-site && npm install && npm start
```
