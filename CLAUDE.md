# Argus

Self-hosted OSINT visualizer: a CesiumJS globe fed by collectors (USGS,
GDELT, RSS, FIRMS, adsb.lol / adsb.fi), with event fusion, accounts and live updates.
See README.md for the overview and `docs-site/docs/technical/` for how the
parts connect.

## Layout

- `backend/argus/`: FastAPI app (Python 3.12, SQLAlchemy 2 async, asyncpg).
  - `collectors/`: one module per source; `worker.py` schedules them and
    publishes to NATS; `fusion.py` turns raw records into events.
  - `api/`: routers; `/ws/live` checks Origin == Host and the session.
  - `aviation.py`: airports/airlines, ADS-B feeds + adsbdb client, live
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
    `backend/scripts/build_*.py`. Frontend data (`frontend/public/data/`:
    cities, airports, ports) comes from `build_labels.py` and
    `build_ports.py` (UN/LOCODE); the 3D models in
    `frontend/public/models/` from `build_models.py` (generated, no
    external assets).
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
- Airspace (TFRs, SIGMETs, CZIBs) are raw records of kind `airspace`,
  not events; `/api/airspace` serves the ones still fresh and valid.
  Infrastructure: power plants are bundled (`build_power.py`), cables are
  fetched by the worker into `server_settings["layer:cables"]` because of
  their non-commercial licence; never bundle them.
- openAIP (key in Data sources) is fetched per 2-degree tile for the
  view and cached a day in API memory (`argus/openaip.py`); its licence
  is non-commercial, so don't persist it. Its Cloudflare can 403 whole IPs (an HTML
  `cdn-cgi` page, status `blocked`); never work around it (no spoofed
  browser user agents). Military bases are bundled
  from an Overpass query by `build_bases.py` (ODbL).
- Your own receivers: `receivers_loop` in the worker; local aircraft go to
  `app.state.local_air` (NATS `argus.local_air`), ships into `LiveSea`.
- News channels live in `frontend/src/config/newsChannels.ts`; verify a new
  channel ID with `https://www.youtube.com/feeds/videos.xml?channel_id=`.
  YouTube no longer plays `embed/live_stream?channel=`; the API resolves
  the live video ID from the channel's `/live` page (`argus/youtube.py`,
  cached) and the player embeds `/embed/<video id>`. Channels not on
  YouTube use Rumble (`platform: 'rumble'`, resolved from the channel's
  livestreams JSON plus oEmbed); new embed hosts go in the CSP frame-src.
- Tension index: `argus/tension.py`. Standing level from UCDP deaths
  (`data/conflict.tsv.gz`, rebuilt by `scripts/build_conflict.py` from
  the GED + Candidate Events downloads; CC BY 4.0) plus up to 20 live
  points from confirmed events. `tension_daily` hourly samples (worker
  `tension_loop`, `backfill` once) only feed "vs normal".
  `/api/tension` is cached a minute.
  Country names are GDELT/GeoNames style; `map/tensionLayer.ts` maps
  them to Natural Earth's short names (`NE_NAME`) for the tint.
- Big static line sets (state borders: 44,000 lines) go through
  `map/lineBatch.ts` (one Primitive, per-instance colour). A
  `PolylineCollection` with a material per line is one draw call per line
  and crawls; sharing one material there gets it destroyed twice.
- GPS interference cells are hexagons (`aviation.hex_cell`), not squares.
- Labels: Argus labels down to `TILE_LABELS_BELOW` (overlays.ts); below
  it the basemap's label tiles (`LABEL_LAYERS` in Globe.tsx) and the
  self-hosted street map fade in. Mark any new label-carrying imagery
  layer with `labelLayer()`, or names double up.
- Look: match `docs/mockup/` (local only; render argus-mock.html in
  headless Chrome to compare). Colours are the mock's tokens
  (`styles/tokens.css`); the cursor readout and scale bar read
  `lib/cursor.ts`, which Globe.tsx writes, so mouse moves don't
  re-render the map page.
- Server-wide defaults (Settings > Defaults, `server_settings["defaults"]`,
  `/api/admin/defaults`) come with `/api/me` as `defaults`; the map layers
  merge as built-in < server < user (`serverFilters` in LayerPanel).
  Video prefs live in `lib/video.ts` (user over server).
- Wall pairing: `api/displays.py`. Pairings are in API memory
  (`app.state.pairings`, one uvicorn process); approving creates a
  display-role user, and the screen's poll gets a remember-me session.
  `/pair` is the only page shown signed out besides login and setup;
  display users are redirected to `/wall`.
- Weather: NWS alerts (`nws`, raw kind `wxalert`) and SPC outlooks
  (`spc`, kind `outlook`) in `collectors/weather.py`, served by
  `api/weather.py` (also Open-Meteo `/api/weather/now` and the home's NWS
  zones via api.weather.gov/points, cached). GIBS imagery in
  `map/wxLayer.ts` needs GIBS's own 2 km tile grid (512 px, -180..396°)
  and the layer name in the URL (Cesium doesn't fill `{Layer}`).
  Zone-based alerts are drawn on NWS zone outlines (`nws_zones`, fetched
  by the worker's `zones_loop`, 60 a pass a second apart, simplified with
  `geo.simplify`); `/api/weather/alerts?zones=1` adds them as `zoned`.
- Closed airspace (CZIB) hatching is real lines (`lib/geo.hatchLines`,
  batched per colour through `lineBatch`). Cesium's Stripe material on a
  PolygonGeometry didn't render visibly; don't go back to it.
- Pages: Map (`/`), Brief (`/brief`), Wall (`/wall`, reuses `Globe` with
  minimal props), Settings. A Brief theatre card hands the map a place to
  fly to through `sessionStorage[FLY_KEY]` (lib/share.ts).
- The globe is created with `orderIndependentTranslucency: false`; add
  `?fps=1` to the URL for Cesium's frame-rate counter.
- 3D models: one per kind (`build_models.py`), chosen by
  `aircraftModel`/`shipModel` in `map/closeModels.ts` and loaded on
  first use.
- Hazards (GDACS, EONET, tsunami) and NGA warnings are keyed events
  (`fuse_hazard`, `fuse_navwarn`) whose raw records update in place
  (`UPDATABLE_KINDS`).
- ADS-B feeds rate-limit per IP, shared by every Argus stack on this
  machine: adsb.lol allows 500 requests a day (429 with
  `x-ratelimit-remaining: 0` and `x-ratelimit-reset` in seconds), adsb.fi
  one a second. All calls go through `aviation.FeedClient` (order, spacing,
  per-feed pause until reset, fallback); the worker's military poll uses
  `POLL_ORDER` (adsb.fi first), the API `VIEW_ORDER`. Don't add direct
  calls. Throwaway stacks spend the same quota: keep
  `ARGUS_AIR_ENABLED=false` there.
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
- Format frontend code with `npx prettier --write <files>` (frontend/.prettierrc:
  single quotes, 120 columns). Don't run prettier on whole files you
  only touched lightly if that rewraps unrelated code.
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
