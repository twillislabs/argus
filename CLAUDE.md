# Argus

Self-hosted OSINT visualizer: a CesiumJS globe fed by collectors (USGS,
GDELT, RSS, FIRMS, adsb.lol), with event fusion, accounts and live updates.
See README.md for the overview and `docs-site/docs/technical/` for how the
parts connect.

## Layout

- `backend/argus/`: FastAPI app (Python 3.12, SQLAlchemy 2 async, asyncpg).
  - `collectors/`: one module per source; `worker.py` schedules them and
    publishes to NATS; `fusion.py` turns raw records into events.
  - `api/`: routers; `/ws/live` checks Origin == Host and the session.
  - `aviation.py`: airports/airlines, adsb.lol + adsbdb client, live
    military picture (`LiveAir`). The worker polls `/v2/mil` and publishes
    on NATS `argus.air`; civil traffic is fetched by the API per view.
  - `roles.py`: roles and their capabilities. Gate endpoints with
    `Depends(require("capability"))` from `api/deps.py`, never by
    comparing role names; the frontend checks `can(user, "...")`.
  - `api/users.py`: user management (admins) and your own account.
    While `must_change_password` is set, `current_session` refuses every
    path except `PASSWORD_CHANGE_PATHS`.
  - `api/admin.py`: server-wide settings (admins) and `/api/map/config`
    (everyone). Settings live in the `server_settings` table; secrets in
    them go through `argus/secrets.py` (Fernet, keyed from
    ARGUS_SECRET_KEY) and are never returned to admins in full.
  - `search.py`: universal search; `decode()` is pure, `resolve()` looks
    things up. New query kinds go in both, with tests in
    `tests/test_aviation.py`.
  - `data/*.tsv.gz`: bundled reference data, rebuilt by
    `backend/scripts/build_*.py`.
- `backend/migrations/`: Alembic; the API applies them on start.
- `frontend/src/`: React 18 + TypeScript + Vite (`pages/`, `components/`,
  `map/`, `lib/`, `styles/`). Build output keeps JS, CSS, fonts, images and
  vendor files in their own folders (`vite.config.ts`).
- `docs-site/`: Docusaurus, served at `/docs/`.
- `streetmap/`: tileserver-gl config and the Argus Dark street style
  (Protomaps v4 schema). Data lives in `data/streetmap/` (gitignored),
  downloaded by `scripts/streetmap.sh` / `make streetmap`.
- `docker-compose.yml`: db (PostgreSQL 17 + TimescaleDB + PostGIS), nats,
  api, worker, web (nginx with the CSP).

## Commands

- `make ci` runs everything GitHub Actions runs (`scripts/ci.sh`); run it
  before every commit. `make ci-quick` skips migrations.
- `make test`, `make lint`, `make up`, `make logs`, `make token`.
- Backend tests use SQLite (aiosqlite) and no NATS; no services needed.

## Gotchas

- `schemas.Preferences` forbids unknown keys: a new preference saved by the
  frontend needs a field there, or the PATCH fails with 422.
- Cesium keeps moving classes from `@cesium/engine` to `@cesium/core`
  (Cartesian*, Color, Rectangle, NearFarScalar, DistanceDisplayCondition).
  Import from core when the console warns.
- Mermaid in the docs: `;` ends a statement, so never use it inside diagram
  text. The docs build doesn't catch diagram errors; check the page.
- The Google key is sent to signed-in browsers (Cesium fetches Google
  tiles directly). New external tile hosts must be added to the CSP in
  `frontend/nginx.conf` (img-src and connect-src).
- nginx uses `absolute_redirect off` so redirects keep the host port.
- After editing `streetmap/styles/argus-dark.json`, bump
  `STREET_STYLE_VERSION` in `Globe.tsx` (tiles are cached by nginx and
  browsers) and `docker compose restart tiles`. Style expressions can't be
  data-driven in `symbol-placement`; tileserver logs invalid styles at start.
- nginx only exposes `/tiles/styles/argus-dark/256/...png` and
  `/tiles/data/protomaps.json`; anything else under `/tiles/` is 404.
- GDELT is noisy: `fusion.review_gdelt` decides active vs candidate from
  outlet agreement on one CAMEO root *and* corroborating RSS headlines
  (`corroborating_articles`). Don't promote GDELT events anywhere else.
- adsb.lol's routeset endpoint is unusable (202, empty); routes come from
  adsbdb, which goes stale when flight numbers are reused
  (`route_progress` flags implausible routes).
- CelesTrak blocks clients that fetch a group more than about once every
  two hours. The worker's `space_loop` waits out six hours from the last
  success (kept in `sources`), even across restarts. For throwaway stacks
  run with `ARGUS_SPACE_ENABLED=false` and load a saved copy instead of
  fetching again.
- satellite.js's main entry pulls in a WebAssembly build; import its JS
  modules through the `satellite-core/` alias (vite.config.ts, tsconfig).
- Vessels: the worker's `sea_loop` holds one AISStream WebSocket (key from
  `server_settings["keys"]`), publishing changes on `argus.sea`; the API
  keeps them in `LiveSea` and serves them by bbox. They aren't stored or
  pushed to browsers. Data source keys live in Settings > Data sources
  (`/api/admin/keys`).
- Hazards (GDACS, EONET, tsunami) and NGA warnings are keyed events
  (`fuse_hazard`, `fuse_navwarn`) whose raw records update in place
  (`UPDATABLE_KINDS`).
- adsb.lol rate-limits per IP (429), shared by every Argus stack on this
  machine. All calls go through `AirClient._adsb_get` (spacing, pause on
  429, stale cache). Don't add direct calls.
- Map markers use `disableDepthTestDistance` = horizon distance (infinite
  in 2D), set in `Globe.tsx`; otherwise the dark map's land and border
  shapes clip them. New primitive collections need the same.
- Aircraft camera views live in `map/aircraftCamera.ts`: they keep the
  camera offset in the aircraft's ENU frame (`lookAtTransform`) and
  dead-reckon between reports. Call `release()` before any `flyTo`.

## Rules

- Keep this file current: when work adds a module, a convention or a
  gotcha, update CLAUDE.md in the same commit.
- Python: PEP 8 at 79 columns (ruff). Strings use `str.format()` only: no
  f-strings, `%` or `+` concatenation.
- TypeScript is strict. Use `@cesium/engine` and `@cesium/core`, never the
  full `cesium` package in code: its widgets need `eval`, which the CSP
  blocks. `cesium` is only a source of static assets for `/vendor/cesium`.
- Keep the CSP strict; self-host fonts and vendor assets. No Cesium ion.
- Commits: Conventional Commits, 50/72, authored by the user, no AI
  co-author trailers. During initial development, commit and push to
  `main`, then watch CI to green.
- Never commit `.env`, `docs/PLAN.md` or `docs/mockup/` (local only).
- Privacy: drop PIA/LADD aircraft unless military; never store or return
  registered owner names. Store only headline, excerpt and link for news.
- Testing in a browser: use a throwaway compose project (for example
  `docker compose -p argus-e2e`) on another port and remove it with
  `down -v`. Don't reset the main stack on :8080; it holds real accounts.
- Don't print the setup token; point to `make token`.
- After each chunk passes CI, rebuild the main stack
  (`docker compose up -d --build`, data kept) so the user can try it.
