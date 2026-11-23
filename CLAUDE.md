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
    comparing role names; the frontend checks `can(user, "...")` or,
    where the user isn't passed down, `canI("...")` (set by App).
    `argus/access.py` narrows `RESTRICTABLE` capabilities (ai.use,
    alerts.use, api.tokens, video.search) to groups and people
    (`server_settings["access"]`, tables `user_groups` and
    `user_group_members`, migration 0012, `api/groups.py`);
    `capabilities_for`/`may` are the only answer to "may they", used by
    `require`, `/api/me` (UserOut keeps capabilities it's given),
    `token_session`, tokens and AI. Admins always pass. A new
    limitable feature: a capability in roles.py, an entry in
    RESTRICTABLE, and the UI's check.
  - `api/users.py`: user management (admins) and your own account.
    Sign-ups: `server_settings["signup"]` (`SignupSettings`: open,
    approval, role viewer|analyst), `POST /api/auth/signup` (public,
    `signup_limiter`), `users.approval_pending` (migration 0011; login
    refuses it with 403 only after the right password), approve via
    `/api/admin/users/{id}/approve`, `/api/me` `pending_signups` for
    admins, `/api/setup/status` `signup` for the sign-in page's link.
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
  The GitHub wiki is generated from it on push to main
  (`.github/workflows/wiki.yml` runs `scripts/docs_to_wiki.py`: page
  names from titles, intro is Home, links rewritten, admonitions to
  GitHub alerts, `_Sidebar.md` from sidebars.ts); never edit the wiki.
  A new doc page goes in `sidebars.ts` or it lands last.
- `streetmap/`: tileserver-gl config and the Argus Dark street style
  (Protomaps v4 schema). Data lives in `data/streetmap/` (gitignored),
  downloaded by `scripts/streetmap.sh` / `make streetmap` (a region of
  several boxes, `;`-separated like `us`, goes to pmtiles as a GeoJSON
  MultiPolygon, `--region`, written to `data/streetmap/region.geojson`).
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
  YouTube search uses `safeSearch=moderate`: `strict` returns no live
  streams at all (checked 2026-11-20).
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
  `cams.OPEN_FEEDS`. A camera with `image_json` (TxDOT) has its still
  as base64 in that JSON field; `_json_image` decodes JPEG or PNG only.
  Video-only cameras (DelDOT) have `image: None`; `_public` sends
  `image: null`, the inspector shows the video, camView draws nothing.
  Video hosts in the CSP: wzmedia.dot.ca.gov, *.skyvdn.com,
  video.deldot.gov, kamera.vegvesen.no.
  Left out on purpose: Live Traffic NSW (its images answer only a
  browser's User-Agent; don't fake one), FL511 (personal use only),
  Ottawa (registration certificate) and Catalonia (its HTTPS handshake
  fails; plain http only).
  The selected camera's still is drawn in the scene by `map/camView.ts`
  (a view cone and an upright WallGeometry panel with an Image material
  at camLayer's `VIEW_RANGE_M`, or a billboard when there's no
  direction); `GlobeHandle.lookAlong` flies behind it.
  The map groups nearby cameras (`map/groups.ts`, shared by camLayer
  and alprLayer: grid by camera height, badge ids
  `group:<prefix>w,s,e,n`, `zoomToGroup` in Globe's click).
  `cams_loop` runs `cams_pass` under a catch-all and
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
- News feeds and live channels are admin settings (`argus/newsconfig.py`,
  `api/news.py`, Settings > News feeds and Live channels): the built-in
  lists (`rss.DEFAULT_FEEDS`, `newsconfig.BUILTIN_CHANNELS`) apply until
  an admin saves an edited list (`server_settings["news:feeds"]`,
  `["news:channels"]`, `{"items": [...]}`); Reset deletes it, so new
  built-in entries reach installs that never edited. Feeds carry
  `section` (what the feed covers, never an outlet's politics:
  `OUTLET_SECTIONS` for whole-site feeds) and `based` (us/world, used by `us_or_world` for stories
  naming no country); `RssCollector.prepare` reads them (the worker
  calls `Collector.prepare(session)` before each `collect`). Channels
  reach browsers in `/api/me` (`channels`, enabled only); the app puts
  them into `CHANNELS` with `setChannels` (in place) before pages draw,
  so code reading `CHANNELS` and `channelGroups()` sees the server's
  list; `frontend/src/config/newsChannels.ts` only holds the fallback.
  Admins add a channel by link, `@handle` or ID (`youtube.lookup_channel`:
  handle page for the ID, the channel feed's title, `resolve` for live
  status); feed tests fetch through `url_allowed`.
  When adding built-in channels, verify the ID with
  `https://www.youtube.com/feeds/videos.xml?channel_id=`.
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
  livestreams JSON plus oEmbed), Dailymotion (its public API, no key,
  `live_onair`) or Kick (`player.kick.com/<slug>`, never checked: Kick's
  API needs a user token; `unverified: true`); `youtube.PLATFORMS`,
  `PLATFORM_PATTERN` and the frontend's `Platform`/`PLATFORM_NAME`
  (config/newsChannels.ts) list them. New embed hosts go in the CSP
  frame-src. Live near the view also searches Dailymotion without a key
  (`Video.dailymotion_near`: the area's biggest places by name via
  `places.largest_near`, then live channels by country; items carry
  `platform` and `where`).
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
  `map/patternLayer.ts` (rings pick as `ac:<hex>` / `ship:<mmsi>`
  through a wide, near-invisible twin ring: alpha 0 is never picked),
  the Situation panel's Patterns section; wording in `lib/patterns.ts`,
  shared with the inspectors' `pattern` prop and the hover card.
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
  allows 15 requests an hour per IP; `mode=detailed` for the mission's
  webcast and info links, kept as `links` with Space Launch Now and the
  pad's pages, Wikipedia last), `/api/launches`,
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
  disk in `ARGUS_IMAGERY_CACHE_DIR`; tiles are 512 px `@2x`, with
  `tileWidth`/`tileHeight` 512 in sentinelLayer, so 10 m pixels stay
  sharp), `map/sentinelLayer.ts` (box-limited
  ImageryLayer, compare via `scene.splitPosition`),
  `components/ImageryPanel.tsx` (state kept in MapPage as `sentinel`).
  Close up, Esri World Imagery (browsers fetch it from Esri, like the
  basemap) and NAIP aerial photos (US, 0.6 m, kind `aerial`,
  `Imagery.aerial`: newest on top over the last `AERIAL_YEARS`) draw
  over the pass from terrain level `CLOSE_FROM_LEVEL` (ImageryLayer
  `minimumTerrainLevel`), the newer of the two on top (`closeUpFor`),
  hidden while comparing. `/api/imagery/aerial` returns both: NAIP's
  mosaic and dates, and `esri` (`Imagery.esri_source`, Esri's identify
  service at the box's centre: date, resolution, source). The base map
  effect's `removeAll()` drops these layers: `sentinel.reattach()` adds
  them back, and `raise()` keeps them over the late street map layer.
  Tile zooms per kind are `ZOOMS`. Sentinel-2's 10 m is the
  source's limit (zoom 13 at 512 px), not a bug.
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
  profile and by Sync / Reload in Settings; Identify
  (`/api/admin/displays/{id}/identify`, `app.state.wall_identify`)
  adds `identify` {name, seconds} to that screen's sync answer and the
  wall shows `.widentify`; WallEditor saves itself 900 ms after a
  change; the same poll renews a
  display session (and its cookie) once under 20 days are left.
  `mode: "tv"` makes the wall
  live TV only (`tv_channels`, `muted`, `volume`; LiveFrame's `audio`
  prop applies sound changes through the YouTube player API).
- Themes: `lib/themes.ts` (built-ins in `BUILTIN_THEMES`, `resolveTheme`
  from a base, `chooseTheme` mine > server > dark, `applyTheme` sets CSS
  variables and `data-corners/overlay/stripe/theme` on <html>,
  `onThemeChange`), `styles/themes.css` (effects by data attribute),
  `backend/argus/themes.py` (`BUILTIN`, `clean`: every custom value from
  a list or a strict pattern), `api/themes.py` (`/api/theme` public for
  signed-out pages, `/api/admin/themes`), preference `theme`,
  `defaults.theme`, `/api/me` `themes`. Stylesheets use `--radius`,
  `--radius-s`, `--glow`, `--map-*`, `--hdr-*`, `--accent-text` and
  `color-mix(var(--surface) N%)` for see-through panels, never fixed
  values. The globe repaints via `darkMap.setPalette`; `lightMap` swaps
  to Esri light grey. Fonts are self-hosted `@fontsource` (CSP). Docs:
  using/themes.md (format), technical/themes.md (adding one).
- Page titles are set per route in `App.tsx` (`pageTitle`); only
  NewsPage sets its own.
- Settings menu: `SECTIONS` in SettingsPage, grouped by `GROUPS` (You,
  Map and data, News and video, People and screens, System), each with
  `keywords` for the menu's search (Enter opens the first match). New
  pages go in a group, not a new one per page.
- Drawing previews (`drawTools.renderPreview`) are dashed
  (`PolylineDash`) until the last click. Capture (`GlobeHandle.capture`)
  renders at twice the device's pixels, waits up to 8 s for the sharper
  tiles, then restores `resolutionScale`.
- Weather extras (all keyless): `WeatherFilters` in `map/wxLayer.ts`.
  Imagery layers are `WX_IMAGERY`, each in `IMAGERY` with a refresh
  period (a new layer per slot, with a `t=` stamp so caches let go) and
  an opacity (`weather_opacity` preference, `opacityOf`); NASA GIBS
  (clouds, IMERG) and NOAA nowCOAST WMS (radar mosaic, lightning, water
  vapour, sea temperature; `nowcoast.noaa.gov` is in the CSP). Land-
  covering ones are `WX_OVER_LAND` (the dark map's land goes
  see-through). Tropical storms: `argus/storms.py` (GDACS list, then
  each storm's geometry: track segments unordered, so the category now
  is the segment leaving the centroid; `Poly_Cones`; swath polygons
  labelled 60/90/120 km/h without `featuretype`), `/api/weather/storms`
  (cached 30 min in API memory, `app.state.storms`), drawn by wxLayer
  as `storm:<id>`. "Weather here" (`components/WeatherHere.tsx`, from
  MapContextMenu) reads `/api/weather/forecast` (Open-Meteo, 15 min per
  spot) and, in the US, `/api/weather/alerts?lat=&lon=`'s `local`.
  Wall layers `wx_storms`, `radar`, `lightning`, `vapour`, `sst`,
  `wind`. `WeatherFilters.loop` plays radar and clouds (`LOOPABLE`,
  `LOOP_MAKE`) as `LOOP_FRAMES` layers 10 minutes apart (nowCOAST WMS
  `time`, GIBS `Time`), cycled by alpha with a `.wxloop` label in the
  map cell (home time via `setTimeZone`, else UTC); looped entries use
  negative slots.
- Satellite passes (`satWorker.ts` `passes`): rise/set azimuths and
  `visible` (sunlit by a cylindrical shadow test, `sunEci` low-precision
  Sun, observer's Sun below -6°); SatelliteInspector can use the map
  centre instead of home (`mapCentre`).
- Public transport: `argus/transit.py` (`FEEDS`: operator, area, URL,
  licence; GTFS-Realtime via `gtfs-realtime-bindings`), `/api/transit`
  (6-degree views at most), only overlapping feeds are fetched, each at
  most every `MIN_AGE_S`; `map/transitLayer.ts` (`transit:<op>:<id>`,
  hover card only, no selection). Add a feed only with a keyless URL
  and an open licence, credited in README.
- Wildfire outlines: `argus/fireperims.py` (NIFC WFIGS Interagency
  Perimeters Current, keyless, simplified server-side and with
  `geo.simplify`, cached 30 min in API memory), `/api/fires/perimeters`,
  drawn by wxLayer (`WeatherFilters.fires`, `fire:<id>`); a click opens
  the event whose `key` is the perimeter's `event_key` (`nifc:<id>`;
  `event_dict` now returns `key`), else an info panel.
- Sign-in pages: `components/AuthShell.tsx` (HUD brackets `.bracket`,
  not `.hud`: that class is the cockpit HUD's; UTC readout, `WATCHES`
  ticker), `AuthGlobe.tsx` (canvas: stars, night from `subsolar`,
  its own palette from the theme's: sea tinted to the accent, land
  lifted, accent coastlines, since map land and sea can match;
  `ROUTES` flights, `ORBITS`, conic sweep; all still under reduced
  motion). The globe fills the page behind a frosted form card (left of
  centre on wide pages, near the top on tall ones: `tall`), dimmed
  towards the form by `.auth-art::after`.
- Global Fishing Watch: `argus/fishing.py` (key `gfw` in Data sources,
  Events API POST per `TILE_DEG` tile, encounters/loitering/gaps, last
  `DAYS`, cached `TTL_S` in API memory: CC BY-NC and the token must stay
  server-side, so never persist it or send it to browsers; datasets a
  token can't read go in `refused`), `/api/fishing?bbox=`,
  `map/fishingLayer.ts` (`gfw:<id>`, info panel), wording in
  `lib/fishing.ts`. Its toggle is `InfraFilters.fishing` but the row
  sits in the Sea group (SeaFilters keys are vessel categories:
  `seaOn` checks them all).
- Camera picture: the selected traffic camera's still in the scene
  (camView) only with the `cam_picture` preference (Settings › Display,
  off by default); the camera being looked at is ringed (camLayer
  `ring`, traffic cameras and webcams).
- Street view: `argus/streetphotos.py` (Mapillary graph API with the
  `mapillary` key, CC BY-SA; always returns `street_view`, a keyless
  Google Maps Street View URL, the panel's main button: Mapillary isn't
  universal in the US); the image proxy fetches only URLs a search
  returned (`allowed`), never a client's. Panoramax was dropped
  (2026-11: mostly France). `components/StreetPhotos.tsx` from
  MapContextMenu ("Street view here").
- Radio: `argus/radio.py` (Radio Browser mirrors de1/de2, daily, HTTPS
  non-HLS streams only), `map/radioLayer.ts` (`radio:<uuid>`, grouped),
  `components/RadioInspector.tsx` (an `<audio>` that stops on leaving).
  `media-src https:` in the CSP is for these streams.
- API tokens and MCP: `models.ApiToken` (SHA-256 digest only, shown
  once; migration 0010), `api/tokens.py` (`/api/me/tokens`, cookie
  sessions only), `deps.token_session` makes a transient read-only
  UserSession for `Authorization: Bearer argus_...`; GET only and only
  `TOKEN_PATHS` (map data; never admin, me, backups). `api/mcp.py`: MCP
  Streamable HTTP, stateless JSON at POST `/api/mcp`; tools call our own
  API through ASGITransport with the caller's token; Origin must match
  Host when sent. New tools: read-only, add their paths to TOKEN_PATHS.
- Animated wind: `argus/wind.py` (GFS u/v at 10 m from PacIOOS ERDDAP
  `ncep_global`, 1 degree, once per 3-hour step, `app.state.wind`),
  `/api/weather/wind`, drawn by `map/windLayer.ts` on its own 2D canvas
  over the globe (`v.container`), NOT through Cesium, so render-on-
  demand stays intact; its FPS and particle count follow the `render`
  preference. Never pass a frozen Cesium constant (`Rectangle.MAX_VALUE`)
  as a `result` scratch: it throws inside Cesium's render and stops the
  globe. Capture doesn't include the wind canvas.
- Air quality: `argus/airquality.py` (Open-Meteo, `app.state.air_quality`;
  `app.state.air` is the aircraft feed), a grid over the view
  (`grid_step`, at most `MAX_POINTS`, points on step multiples so pans
  reuse the hourly per-point cache, `HOURLY_BUDGET` new points an hour
  per server), `/api/weather/air?bbox=`, `/api/weather/air/here`.
  `map/airLayer.ts` paints one pixel per point and stretches it over
  the area (Image material) for a smooth tint, plus labels.
- Phones (860 px and under, `lib/useMedia` `PHONE_QUERY`):
  `styles/mobile.css` (imported last) overrides the desktop layout. The
  map page shows one panel at a time as a sheet over the map (`sheet`
  state in MapPage, `showLeft`/`showRight`, the `.mobtabs` bar; not
  saved, unlike `left_open`/`right_open`), and `openRight` opens the
  sheet. Check new pages at 390 px for sideways scrolling. Sheets
  are `components/Sheet.tsx` (MapPage `sheetWrap`: slide-up, handle
  drag with the distance in a ref, half/full); Settings on phones is
  `menu-only` at /settings and `section-only` with `.sback` on a
  section. Tool rows scroll sideways (masked edge), the timeline is a
  two-row grid.
- Icons: `frontend/public/favicon.ico` (16/32/48), `apple-touch-icon.png`
  (180, full square: iOS rounds it), `img/icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (mark in the 80% safe zone) and
  `manifest.webmanifest` (nginx gives it `application/manifest+json`).
  They're renders of `img/favicon.svg`'s mark: re-render all of them
  if the mark changes. The status bar is see-through when installed, so
  `.app` pads by `safe-area-inset-top`.
- YouTube embeds need `referrerPolicy="strict-origin-when-cross-origin"`
  on the iframe: nginx sends `Referrer-Policy: same-origin`, and without
  a referrer YouTube's player shows error 153. Videos pop out to
  `/news?v=<id>&t=<title>` (`popOutVideo`), channels to `/news?c=`.
- Feed sections and channel groups are stored with their lists
  (`{"items", "sections"}` / `{"items", "groups"}`, `newsconfig.names`)
  so empty ones exist and keep their order; `NameHeader` moves, renames
  (merges) and deletes them, `ChoiceInput` picks one (a select plus
  "New…"; a datalist only matched what was already typed). Channels are
  saved sorted by group so the players follow the group order.
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
  minimal props; not in the toolbar, it's for displays: the account
  menu's Open wall view opens it in a new tab), Settings. A Brief
  theatre card hands the map a place to fly to through
  `sessionStorage[FLY_KEY]` (lib/share.ts).
- Rendering is on demand (`map/render.ts`, `governRendering`): Cesium
  redraws at full rate on input (for 1.5 s), camera moves, tile loads
  and while a camera rides an aircraft, and otherwise every
  `IDLE_MS[mode]` (the `render` preference: smooth 0, balanced 100,
  saver 500 ms; MSAA 4/2/1 in 3D). Anything that changes primitives
  shows on the next idle frame; code that must show at once (capture)
  calls `scene.requestRender()` before `render()`. `?fps=1` turns
  on-demand off so the counter measures the real rate. The satellite
  tick skips hidden tabs.
- The globe is created with `orderIndependentTranslucency: false`; add
  `?fps=1` to the URL for a frame-rate counter (our own `.fpsbox`;
  Cesium's needs its widget CSS, which isn't loaded).
  MSAA is 4x in 3D and off in 2D (`applyMsaa`): 2D fills the canvas.
  `MapMode2D.ROTATE` looked like it stalled 2D tile loading; leave
  infinite scroll.
- 3D models: one per kind (`build_models.py`), chosen by
  `aircraftModel`/`shipModel` in `map/closeModels.ts` and loaded on
  first use. Space models carry vertex colours (`paint()`, COLOR_0);
  the rest are white for tinting. `map/spaceModels.ts`: `spaceRole`
  by NORAD/name (iss, tiangong, dragon, soyuz, shenzhou, cargo, stage,
  `part:*` for a station's separately catalogued modules), one Model
  per object (id `sat:<norad>`, so picks select it), vehicles within
  `DOCK_M` of a station drawn at its `PORTS` (glTF axes, from the
  station builders' docstrings; vehicle models have their docking ring
  at the origin, body along -Z), stations scaled by hand with their
  docked vehicles (`minScale`, measured from where a follow camera is
  about to be: models are placed before it moves, so the last camera
  position is a frame of orbital motion out). `satellites.ts` draws
  every satellite `SMOOTH_LAG_MS` late, between its last two 1 Hz
  samples (worker ticks echo their `time`); `position()` is the drawn
  one. Follow (Globe `followSatFrame`) runs every frame; the wheel and
  pinch scale the camera's offset while following (capture listeners,
  down to `nearest()`): Cesium sizes zoom steps by height above the
  ground, so in orbit one notch flew through a station. The Space
  stations toggle is `SpaceFilters.iss`. Launch pads with a launch
  coming stand a rocket inside 40 km: `rocket-<family>.glb` picked by
  `rocketModel` (launchLayer.ts: name patterns in `ROCKETS`, Falcon 9
  with Dragon by mission name, heights for the orbit view), else the
  generic `rocket.glb` (+Y up); double-click orbits it
  (`GlobeHandle.orbitAround`). A pivot hold doesn't count as riding
  for `governRendering` (its `still` callback): the rocket doesn't
  move, so it renders at the idle rate.
- Camera holds: the aircraft tracker, satellite follow and
  `orbitAround` all put the camera in a lookAt frame. Globe's
  `camHeld` records the satellite/pivot holder and `freeCamera()` lets
  go (handle methods that fly, a click on anything else for a pivot,
  follow ending or the satellite deselected, `releaseCamera()` on Esc);
  the tracker's `release()` only drops a frame it set itself
  (`holding`): its `setTarget(null)` runs on every aircraft update and
  used to drop everyone's.
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
- Double-click (`focus` in MapPage, Globe's LEFT_DOUBLE_CLICK passes the
  pick id or null, the marker's own position or the clicked spot, and
  the camera height): follows ac/ship/sat, flies to events
  (`FOCUS_HEIGHT`), selects anything else and flies in by id prefix
  (`ITEM_FOCUS_HEIGHT`, never zooming out); bare map zooms in. New
  pickable kinds get an entry there.
- Map markers use `disableDepthTestDistance` = horizon distance (infinite
  in 2D), set in `Globe.tsx`; otherwise the dark map's land and border
  shapes clip them. New primitive collections need the same. Near the
  limb the depth test still leaks (tiles are chords inside the
  ellipsoid), so a lone entity like the home marker also hides via
  `facesCamera` in 3D.
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
- The local stack is only for testing: start it (or a throwaway
  `argus-e2e` project) while testing, and stop it when the work is
  finished (`docker compose stop`, data kept). The real install is the
  server releases are deployed to.
