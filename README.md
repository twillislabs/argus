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

<p align="center">
  <img src="docs/assets/screenshot-dark.png" alt="Argus: the default dark globe with live events and military aircraft" width="900">
</p>

Argus is a self-hosted visualizer for open-source intelligence (OSINT). It brings conflict and
protest reports, earthquakes, fires, aircraft and the news onto one 3D globe, and will add ships,
satellites, airspace, infrastructure, weather and live video. Every marker shows where it came from
and how sure Argus is about it, and the whole thing runs from one `docker compose up` with no paid
keys.

What it does today:

- **A 3D globe and 2D world map** (CesiumJS) that opens at your home location. The default dark
  map draws countries from bundled Natural Earth data. A **self-hosted street map**
  (OpenStreetMap, rendered on your server) takes over at street level inside
  the region you install. **Satellite** and **Hybrid** go down to street level, like Google
  Maps.
- **Live events**:
  - earthquakes from USGS every minute
  - conflict and protest reports from GDELT every 15 minutes
  - satellite fire detections from NASA FIRMS (with a free key)

  Events are merged across sources and pushed to the browser as they happen.
- **Aircraft.** Military aircraft worldwide every 15 seconds, with their role (tanker, ISR,
  airlift and so on), and civil traffic for whatever region you're looking at. Click one for its
  route and progress, then ride along in **Follow**, **Chase**, **Orbit** or **Cockpit**
  view (with a head-up display).
- **Universal search.** Type a flight number (`AA100`), a hex or tail number, an airport, a
  place, coordinates, an event or a word like `tankers`, and Argus works out what you meant.
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

Coming next: ships, satellites with live orbits,
street-level imagery, airspace and GPS-jamming, weather, news and traffic video, wall mode for a
watch-floor screen, balanced news coverage, alerts, and optional AI (Anthropic, OpenAI or a local
model).

<table>
  <tr>
    <td><img src="docs/assets/screenshot-aircraft.png" alt="Following a flight with its route and progress" width="440"></td>
    <td><img src="docs/assets/screenshot-satellite.png" alt="Satellite view at street level" width="440"></td>
  </tr>
  <tr>
    <td align="center"><sub>Aircraft: search, follow, route</sub></td>
    <td align="center"><sub>Satellite, street level</sub></td>
  </tr>
</table>

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
3. Events start arriving within a minute. **Documentation** in the account menu (top right) has the rest.

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
| `worker` | Collectors (USGS, GDELT, RSS, FIRMS, adsb.lol) and event fusion; publishes changes to NATS |
| `db` | PostgreSQL 17 with TimescaleDB and PostGIS |
| `nats` | NATS JetStream message bus between the worker and the API |
| `tiles` | tileserver-gl: renders the self-hosted street map (`make streetmap` installs a region) |

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
| `backend/argus/aviation.py` | Airports, airlines, the live aircraft picture and the adsb.lol client |
| `backend/argus/search.py` | The universal search decoder |
| `backend/migrations/` | Alembic migrations, applied when the API starts |
| `frontend/src/` | The web app: React, TypeScript and CesiumJS (`pages/`, `components/`, `map/`, `lib/`, `styles/`) |
| `docs-site/` | The documentation (Docusaurus), served at `/docs/` |
| `scripts/ci.sh` | The CI checks, runnable locally |

API docs are at `/api/docs` while Argus is running.

Conventions: Python follows PEP 8 at 79 columns with ruff, and uses `str.format()` for strings.
TypeScript is strict. Commits follow Conventional Commits with 50/72 messages.

## Data and credits

- **Street map:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
  (ODbL), via the [Protomaps](https://protomaps.com/) daily build, rendered with
  [tileserver-gl](https://github.com/maptiler/tileserver-gl) (BSD); Noto Sans fonts (OFL).
- **Maps and imagery:** Natural Earth (public domain), NASA GIBS (Blue Marble), and Esri (Dark
  Gray Canvas, World Imagery and reference layers; © Esri and its data providers).
- **Earthquakes:** USGS (public domain).
- **Events:** the GDELT Project.
- **Fires:** NASA FIRMS.
- **Places:** [GeoNames](https://www.geonames.org/) (CC BY 4.0).
- **Aircraft:** [adsb.lol](https://adsb.lol/) (ODbL 1.0) for positions, [adsbdb](https://www.adsbdb.com/)
  for routes and types, [OurAirports](https://ourairports.com/data/) (public domain) and
  [OpenFlights](https://openflights.org/data) airlines (ODbL 1.0). Aircraft whose owners opted out
  (PIA, LADD) are hidden unless military, and owner names are never shown.
- **Globe:** [CesiumJS](https://cesium.com/platform/cesiumjs/) (Apache 2.0). Argus uses the
  open-source engine only, not the Cesium ion service.
- **Ideas:** [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) (MIT), for several
  planned features.
- **News headlines:** each outlet's own feed. Argus stores only the headline, a short excerpt and
  the link, and always links to the original.
