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
- `docs-site/`: Docusaurus, served at `/docs/`, with local search
  (`@easyops-cn/docusaurus-search-local`, index built with the site).
- `streetmap/`: tileserver-gl config and the Argus Dark street style
  (Protomaps v4 schema). Data lives in `data/streetmap/` (gitignored),
  downloaded by `scripts/streetmap.sh` / `make streetmap`.
- `docker-compose.yml`: db (PostgreSQL 17 + TimescaleDB + PostGIS), nats,
  api, worker, web (nginx with the CSP).

## Commands

- `./argus` (repo root) wraps make/compose and runs `python -m argus.cli`
  (users, reset-password, unlock) in the API container.
- `ARGUS_TLS=self-signed` (+ `ARGUS_TLS_NAMES`, `ARGUS_HTTPS_PORT`):
  `frontend/docker/30-argus-tls.sh` makes a cert into the `web-tls`
  volume and adds `listen 443 ssl` to the server block (plus an
  http->https redirect when ARGUS_HTTPS_PORT is numeric, skipping
  /healthz and X-Forwarded-Proto: https). ARGUS_HTTPS_PORT unset binds
  a random loopback port, so it can't clash. The sign-in page
  explains Secure cookies on plain http (`/api/setup/status`
  `secure_cookies`).
- `make update` (scripts/update.sh): refuses with local changes, backs
  up, `git pull --ff-only`, rebuilds, waits for health.
- Video and webcams: `argus/video.py`, `api/video.py`, keys `youtube`
  and `windy`. Windy's `live` player is a still linking out, so the
  panel plays the `day` timelapse and links live. YouTube searches only
  on a button press (tiny quota),
  cached and shared; Windy image URLs expire in ~10 min, so the list is
  refetched every 5 and previews go through `/api/webcams/{id}/image`.
  Windy's parser is checked against a live answer (2026-11-19).
- `make backup` / `make restore FILE=...` (scripts/backup.sh, restore.sh):
  pg_dump plus `.env` in one archive; restore replaces the database and
  adopts the archive's ARGUS_SECRET_KEY. Test with `--project argus-e2e`.
  Web UI: `argus/backup.py` + `api/backups.py` (capability
  `backups.manage`, password each time; the API image has pg client 17
  from PGDG). Restore goes into `argus_restore`, swaps by rename in one
  transaction, re-encrypts secrets to this server's key, then the API
  SIGTERMs itself (Docker restarts it). Status in a temp file, readable
  signed out.
- Releases: `make release VERSION=X.Y.Z` (scripts/release.sh) needs a
  clean main and a `## [X.Y.Z]` section in CHANGELOG.md; it bumps the
  version in backend (`__init__`, pyproject, uv.lock), frontend and
  docs-site (package.json, package-lock.json), commits and tags vX.Y.Z.
  Push with `git push origin main vX.Y.Z`, then a GitHub release. The
  account menu shows `ARGUS_VERSION` (vite define, from package.json).
  Semver from 1.0.0: note anything an upgrade needs under the version.
- `make ci` runs everything GitHub Actions runs (`scripts/ci.sh`); run it
  before every commit. `make ci-quick` skips migrations.
- `make test`, `make lint`, `make up`, `make logs`, `make token`.
- Backend tests use SQLite (aiosqlite) and no NATS; no services needed.

## Gotchas

- Child rows of `User` rely on ON DELETE CASCADE; ORM relationships to
  them need `cascade="all, delete-orphan", passive_deletes=True`, or
  deleting a user fails (SQLite tests don't enforce foreign keys).
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
- Every response carries `Cache-Control: no-transform` (nginx), so
  Cloudflare's Rocket Loader can't rewrite the page (blank page under
  our CSP). Locations with their own add_header must repeat it.
- Visitor addresses: `frontend/docker/40-argus-real-ip.sh` writes nginx
  `set_real_ip_from` lines from `ARGUS_TRUSTED_PROXIES` (validated) and
  `ARGUS_REAL_IP_HEADER`; nginx then sends the API only `$remote_addr`
  in X-Forwarded-For / X-Real-IP. Never go back to appending
  (`$proxy_add_x_forwarded_for`): uvicorn trusts the header.
- After editing `streetmap/styles/argus-dark.json`, bump
  `STREET_STYLE_VERSION` in `Globe.tsx` (tiles are cached by nginx and
  browsers) and `docker compose restart tiles`. Style expressions can't be
  data-driven in `symbol-placement`; tileserver logs invalid styles at start.
- nginx only exposes `/tiles/styles/argus-dark/256/...png` and
  `/tiles/data/protomaps.json`; anything else under `/tiles/` is 404.
- GDELT is noisy: `fusion.review_gdelt` decides active vs candidate from
  outlet agreement on one CAMEO root *and* corroborating RSS headlines
  (`corroborating_articles`). Don't promote GDELT events anywhere else.
  Titles come from `gdelt_title`: vague codes (`VAGUE_CODES`) read
  "Violence" until confirmed, and `crime_cluster` (article link words)
  marks crime/crash/court clusters, which are never promoted.
  `off_topic(url)` drops an article before it joins or starts an event
  when its link words are readable and about neither violence nor
  unrest (court, legislative and memorial stories unless about war):
  GDELT geocodes any article mentioning a place. `review_gdelt` prunes
  off-topic records from events (`prune_strays`, recounting with
  `tally`/`judge`, the same rules as `fuse_gdelt`), moves misplaced ones
  to the city most links name (`better_place`: 3+ links and 40%+, own
  city in at most 15%; `gazetteer` is 200k+ cities minus
  `PLACE_STOPWORDS`), merging into a same-kind event there, and titles
  confirmed events with their backing headline (`headline_title`).
  `corroborating_articles` skips opinion and question headlines
  (`opinion`); bare "offensive" isn't a conflict word (the adjective).
  Stories: `argus/story.py` (no AI) turns a link or headline into
  stemmed words weighted by rarity across the day's links and headlines
  (`Weights`, IDF), compared by cosine (`SAME_STORY` 0.3). GDELT
  clusters by place and time and files an article once per place it
  mentions, so `review_gdelt` runs in phases: `claim_links` (each URL
  in one event: the one whose city its link names, else best fit),
  `prune_strays`, `split_stories` (keep the story most outlets tell,
  backing headlines bridging differently worded links; the rest are
  `refile`d through `fuse_gdelt`), `relocate`, `merge_stories` (same
  story within `MERGE_KM`, or elsewhere when the links don't name their
  own city but name the other's), `judge_event` (headlines must match
  a link at `HEADLINE_MATCH`), then `merge_duplicates` (sharing a
  backing headline within 50 km). New records pick a cluster by story
  too (`pick_cluster`, with the last pass's weights in `_weights`).
  Tune against real data with a rolled-back dry run, not on the live
  database.
- Incidents (event type `incident`): GDELT clusters `crime_cluster`
  flags become `incident` (the original kind kept in `data["kind"]`, and
  `fuse_gdelt` matches either), confirmed like conflict with
  `INCIDENT_WORDS` headlines; `incident_severity` from `MAJOR_SLUG`.
  Headline-led ones: `argus/newsevents.py` `review` (run by `fuse` after
  RSS) clusters the day's headlines by story; 3+ outlets naming one US
  place (`place_named`: 100k+ cities minus `AMBIGUOUS`, states,
  `NATIONWIDE` stories at the centre) and `newsworthy` (a happening, not
  politics) make a keyed `news:<id>` event, updated by article overlap
  or story match, retired when a confirmed GDELT event tells it, never
  for quakes near a USGS one. `related_articles` reads their
  `data["articles"]`. Adding an event type means: `api/events.TYPES`,
  alerts' Literal, AI tool enum, `search.EVENT_WORDS`/`LABELS`,
  `video.WORDS`, frontend `EventType`, `TYPE_INFO`, `share.ts`,
  LayerPanel defaults and `FEEDS`, SetupPage, MapPage's lists.
- US feeds: `collectors/usgov.py` (`fema`: OpenFEMA declarations, one
  per declaration at the state's population centre; `nifc`: WFIGS open
  wildfires 100+ acres), both kind `hazard`; payloads carry a `seen`
  stamp so they're re-stamped each poll and stay on the 24 h map. NWS:
  `fuse_wxalert` turns `NWS_EVENTS` warnings into `nws:` hazard events,
  expired by `expire_and_prune` at `data["until"]`.
- `ARGUS_COLLECTORS` empty (the default now) runs every collector in
  `REGISTRY`; a pinned list in an old `.env` misses new collectors.
- Brief: sections are `BRIEF_SECTIONS` (schemas.py and api.ts, the
  built-in order, US first); the `brief` preference holds `order` and
  `hidden` (null clears it), edited by the page's Customize panel, over
  the server default `defaults.brief` (Settings > Defaults), both with
  `BriefSectionsEditor`; `briefLayout(mine, server)` adds sections
  added since in their default place. BriefPage calls `onSaved` (App's
  refresh) after saving, or returning to it showed the stale order. `/api/stories`
  (`newsevents.top_stories`, cached 5 min) groups the day's headlines
  by story, ranked by outlets, split by `us_or_world`. `story.clusters`
  indexes terms, so a day of headlines groups in under a second.
- AI status (`useAiStatus`) is shared and re-read after a minute or
  when Settings > AI saves (`forgetAiStatus`): it was cached for the
  page's life, so turning Ask on showed no button until a reload.
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
  their non-commercial licence; never bundle them. Travel advisories
  (`argus/advisories.py`, worker `advisories_loop`, every 6 h) are kept
  the same way in `server_settings["layer:advisories"]`; country names
  are mapped to Natural Earth's (`NE_NAME`) in the backend. Wikipedia
  current events (`argus/wikipedia.py`, `wikipedia_loop`, hourly) too, in
  `layer:wikipedia`; entries are placed at the linked article with the
  smallest coordinate `dim`. They're not events.
- Traffic cameras: `argus/cams.py` (feed parsers), worker `cams_loop`
  (daily, `layer:trafficcams`), `api/cams.py`. Browsers get our proxy
  path (`/api/cams/{id}/image`), never agency URLs; the proxy only
  fetches a camera's own catalogue image (`image_allowed`). Video is the
  exception: `/api/cams/{id}/video` hands the browser the agency's HLS
  or MP4 URL on Play, and each video host must be in the CSP
  (`connect-src` for HLS, `media-src`); add TDOT's stream host there
  (TDOT streams from `*.skyvdn.com`; its stills redirect, which
  `fetch_image` follows with the same check). New no-key feeds go in
  `cams.OPEN_FEEDS`. `cams_loop` runs `cams_pass` under a catch-all and
  saves after each feed, TDOT first. TDOT's
  field names aren't public: `parse_tdot` guesses and logs the keys of
  the first record when nothing parses.
- ALPR cameras (`argus/alpr.py`, `/api/alpr`) come from Overpass per
  1-degree tile for the view, one request per Overpass server at a time
  (overpass-api.de and overpass.kumi.systems, tiles spread by
  coordinates, the other as fallback), kept a week in `alpr_tiles`; the
  worker's `alpr_prefetch_loop` fills 3x3 degrees around saved homes. Filled
  in background tasks (Overpass can take ~40 s a tile, past nginx's 60 s
  proxy timeout), so `/api/alpr` returns cached tiles at once with status
  `partial` and the map asks again; cached a day in API memory.
  Locations only; never add plate data.
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
  Only add channels with a true live stream (24/7 or a live TV
  simulcast; Ryan Hall, Y'all is the exception, live for major weather
  events): check the channel's Live tab ("N watching") and the
  stream's `startTimestamp` on its watch page, not just `/live`, which
  also shows one-off event streams.
  YouTube no longer plays `embed/live_stream?channel=`; the API resolves
  the live video ID from the channel's `/live` page (`argus/youtube.py`,
  cached) and the player embeds `/embed/<video id>`. A scheduled stream
  also says `"isLive":true` (its "waiting" count), so `parse_live`
  checks the video's own `videoDetails` for `isUpcoming` and reports
  `upcoming` with `starts_at` instead. Channels not on
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
  Besides military, view and receiver traffic, the worker's `air_loop`
  sweeps one `aviation.GPS_HOTSPOTS` area per military poll from adsb.fi
  only (`FeedClient.get(..., only=)`), publishing a bare sample
  (`gps_sample`) on NATS `argus.gps`; the API feeds it to `GpsGrid` and
  nothing else (not stored, not pushed). `ARGUS_GPS_SWEEP=false` stops it.
- AI (optional): `argus/ai/` (`providers.py`: one `run()` with a
  manual tool loop for Anthropic via the official SDK and for
  OpenAI-compatible servers via httpx; `config.py`: `server_settings
  ["ai"]` with encrypted keys, per-feature provider/model, monthly cap,
  usage in `ai_usage`; `features.py`: digest, summaries, Ask tools),
  `api/ai.py`, capability `ai.use` (admin, analyst). Collector and news
  text goes to models inside `<data>` blocks; digest sentences without a
  valid `[E:<id>]` citation are dropped (citations after a full stop are
  moved before it first: Claude writes both); GDELT events reach the
  model marked `machine_coded` with their link words, since their place
  is often a capital standing in for a country. Ask gets the user's
  home. Ask Argus tools are read-only
  and `show_on_map` only returns a suggestion. Frontend: `lib/ai.ts`,
  `AiSection`, `DigestCard` (Brief), `AskPanel`, EventInspector's
  `AiSummary`.
- Address search: `argus/geocode.py` + `/api/geocode` (OpenStreetMap
  Nominatim). Its policy forbids autocomplete, so the search box only
  asks on "Find address" (kind `lookup`), never as you type; requests
  are queued 1.1 s apart server-wide and cached a week.
  `ARGUS_USER_AGENT` reaches the containers through compose.
- Ship sanctions: `argus/sanctions.py` (OpenSanctions maritime CSV,
  CC BY-NC 4.0, never bundled; the API needs a key now, the bulk data
  doesn't), worker `sanctions_loop` (daily), `SanctionsIndex` in the API
  (`app.state.sanctions`, reloads when `layer:sanctions` changes).
  `/api/vessels` adds `sanctions` (serious tags) per ship and
  `/api/vessels/{mmsi}` the full `sanctions_listings`. Match by IMO,
  then MMSI, never by name. Alert kind `sanctions`.
- Alerts: `argus/alerts.py` (rule finders per kind, `deliver` to ntfy
  as JSON publish and webhooks as json/discord/slack, quiet hours,
  `url_allowed` blocks loopback, link-local and the compose service
  names), `alerts_loop` runs in the API lifespan every minute (it needs
  LiveAir/LiveSea), tables `alert_rules`, `alert_channels` (ntfy topic
  and webhook URL encrypted), `alerts` (unique rule_id+key: never twice).
  A rule only counts things starting after its `created_at` (reset when
  re-enabled). `api/alerts.py`, capability `alerts.use` (admin, analyst).
  Frontend: `lib/alerts.ts`, `AlertsSection` (Settings > Alerts),
  `AlertBell` (header).
- Air-raid alerts: `argus/raids.py` (Ukraine from ubilling.net.ua's
  relay, times in Europe/Kyiv; Israel from Tzeva Adom's notifications,
  history and locality list), `/api/raids` (cached 20 s, fetched on
  demand), `map/raidLayer.ts`, the Situation panel's `RaidSection`. The
  toggle is `AirspaceFilters.raids`. oref.org.il is geo-blocked outside
  Israel: never route around it. Tzeva Adom's threat ids are in
  `raids.THREATS` (from its own site's table).
- Patterns: `argus/patterns.py` (military orbits/racetracks from
  LiveAir trails; ships loitering near cables from LiveSea.tracks, a
  sample every 5 min, and `CableIndex`, a grid of cable segments rebuilt
  when `layer:cables` changes), `/api/patterns` (cached a minute),
  `map/patternLayer.ts`, the Situation panel's Patterns section.
- Cyber: `argus/cyber.py` (IODA, ransomware.live, CISA KEV), worker
  `cyber_loop`, `/api/cyber`, `map/cyberLayer.ts` (outage tints via
  tensionLayer's shapes and `naturalEarthName`, ransomware markers at a
  country's largest place from `places.tsv.gz`). The toggles are
  `InfraFilters.outages` and `.ransomware`. Never store or show
  ransomware victim names (unverified criminal claims).
- Space weather: `argus/spaceweather.py` (NOAA SWPC scales, Kp and
  alerts JSON, fetched on demand and cached 10 min in API memory),
  `/api/spaceweather`, `components/SpaceWeatherCard.tsx` (Situation and
  Brief). `parse_kp` reads both SWPC shapes (objects, and the older
  list of lists).
- Rocket launches: `argus/launches.py`, worker `launches_loop` (every
  2 h, honouring the last success across restarts: Launch Library 2
  allows 15 requests an hour per IP), `/api/launches`,
  `map/launchLayer.ts` (one rocket per pad, its next launch or its
  latest; pickable as `launch:<id>`, shown in InfoInspector). The
  toggle is `SpaceFilters.launches`, which isn't a satellite class.
- Director mode: `lib/tours.ts` (types, cleanTour, `/#tour=` links as
  base64url JSON), `components/TourPanel.tsx`, playback in MapPage
  (`playTour`, a token cancels it; `GlobeHandle.flyCamera` resolves
  false when the user interrupts a flight). Saved in the `tours`
  preference (`schemas.Tour`, camera text checked by `CAMERA_TEXT`).
- Camera viewsheds (`map/camLayer.ts`): ground sectors in one Primitive,
  rebuilt only when the cameras or selection change (it builds in a
  worker; replacing it each render meant it never showed). It has no
  depth test, since darkMap's land sits 300 m up. A per-instance
  DistanceDisplayCondition attribute made the flat translucent
  primitive draw nothing: don't add one back.
- Recent imagery: `argus/imagery.py` + `api/imagery.py` (Planetary
  Computer STAC search, mosaic register, tile proxy cached a week on
  disk in `ARGUS_IMAGERY_CACHE_DIR`), `map/sentinelLayer.ts` (box-limited
  ImageryLayer, compare via `scene.splitPosition`),
  `components/ImageryPanel.tsx` (state kept in MapPage as `sentinel`).
  Mosaic tile requests need `collection=` as well. Sentinel-1 is the GRD
  collection: sentinel-1-rtc needs a Planetary Computer account. While
  imagery is shown the dark map's land is fully see-through.
- Airports and ports (`map/overlays.ts`) are picked as `apt:<i>` and
  `port:<i>` (index into the bundled JSON); `PlaceInspector` shows them
  with headlines from `/api/news?q=` (`searchTerms` trims "International
  Airport" and the like). FAA status (`argus/faa.py`,
  `/api/airports/status`, nasstatus.faa.gov, cached 2 min in API memory,
  fetched on demand) rings airports via `setAirportRings`; parsed by
  each element with an `ARPT` child, so new delay kinds still appear.
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
  display users are redirected to `/wall`. What a wall shows is the
  `wall` preference (`schemas.WallPrefs`: stops, stop_s, interrupt,
  layers, news, channel, zones), edited by `components/WallEditor.tsx`;
  admins set a screen's (and its home) via
  `/api/admin/displays/{id}/wall`. WallPage re-reads `/api/me` each
  minute. New wall layers go in `WALL_LAYERS` (schemas.py and api.ts),
  sections in `WALL_SECTIONS`. Wall profiles live in
  `server_settings["wall_profiles"]` (`/api/admin/wall-profiles`); a
  screen follows one through its `wall_profile` preference, and
  `/api/me` merges the profile's wall over its own (keeping only its
  home). `/wall?profile=` previews one. Pushing: walls poll
  `/api/display/sync` every 10 s (counters per screen and for all, plus
  a boot id, in API memory; `push_sync`), bumped by saving a screen or
  profile and by Sync / Reload in Settings; the same poll renews a
  display session (and its cookie) once under 20 days are left.
  `mode: "tv"` makes the wall
  live TV only (`tv_channels`, `muted`, `volume`; LiveFrame's `audio`
  prop applies sound changes through the YouTube player API).
- Page titles are set per route in `App.tsx` (`pageTitle`); only
  NewsPage sets its own.
- Toggles (`.lrow` + `.tog`): the checkbox has `pointer-events: none`,
  so the wrapper must be a `<label>` (or sit inside one), or clicks on
  the switch do nothing. Test toggles with real mouse events, not
  `input.click()`.
- Weather: NWS alerts (`nws`, raw kind `wxalert`) and SPC outlooks
  (`spc`, kind `outlook`) in `collectors/weather.py`, served by
  `api/weather.py` (also Open-Meteo `/api/weather/now` and the home's NWS
  zones via api.weather.gov/points, cached). GIBS imagery in
  `map/wxLayer.ts` needs GIBS's own 2 km tile grid (512 px, -180..396°)
  and the layer name in the URL (Cesium doesn't fill `{Layer}`).
  GIBS imagery sits on the globe under `darkMap`'s land shapes, so while
  clouds or precipitation are on the land is kept at `WX_LAND_ALPHA`.
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
  `?fps=1` to the URL for a frame-rate counter (our own `.fpsbox`;
  Cesium's needs its widget CSS, which isn't loaded).
  MSAA is 4x in 3D and off in 2D (`applyMsaa`): 2D fills the canvas.
  `MapMode2D.ROTATE` looked like it stalled 2D tile loading; leave
  infinite scroll.
- 3D models: one per kind (`build_models.py`), chosen by
  `aircraftModel`/`shipModel` in `map/closeModels.ts` and loaded on
  first use. The ISS model (`iss.glb`) lives in `map/satellites.ts`,
  extrapolated every frame from the last two 1 Hz positions; the
  Space stations toggle is `SpaceFilters.iss`.
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
  `ARGUS_AIR_ENABLED=false` there (it stops the worker's polls and the
  API's per-view civil fetches and hex lookups; compose passes it to
  both containers).
- Map markers use `disableDepthTestDistance` = horizon distance (infinite
  in 2D), set in `Globe.tsx`; otherwise the dark map's land and border
  shapes clip them. New primitive collections need the same.
- Aircraft camera views live in `map/aircraftCamera.ts`: they keep the
  camera offset in the aircraft's ENU frame (`lookAtTransform`) and
  dead-reckon between reports (`extrapolateTurning`: along an arc at the
  turn rate from the last two reports, headings eased). Call `release()`
  before any `flyTo`. HUDs (`CockpitHud`, `BridgeHud`) read the camera's
  attitude from `GlobeHandle.attitude()`; Cesium's positive roll is a
  right bank.

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
