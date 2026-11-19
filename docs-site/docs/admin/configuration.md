---
title: Configuration
---

# Configuration

All settings are environment variables, usually set in `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `ARGUS_SECRET_KEY` | (must set) | Signs sessions and encrypts stored API keys (the Google key). Changing it means entering those keys again |
| `POSTGRES_PASSWORD` | (must set) | Database password |
| `ARGUS_HTTP_PORT` | `8080` | Port the web container listens on |
| `ARGUS_COOKIE_SECURE` | `true` | Set `false` only for plain-HTTP local use |
| `ARGUS_LOG_LEVEL` | `INFO` | API log level |
| `ARGUS_SETUP_TOKEN` | random | Fixed setup token for automated installs |
| `ARGUS_SETUP_TOKEN_HOURS` | `24` | Setup token lifetime |
| `ARGUS_SESSION_IDLE_HOURS` | `12` | Idle session timeout |
| `ARGUS_SESSION_MAX_DAYS` | `7` | Absolute session lifetime |
| `ARGUS_SESSION_REMEMBER_DAYS` | `30` | Lifetime with "keep me signed in" |
| `ARGUS_LOGIN_MAX_FAILURES` | `5` | Failed sign-ins before lockout |
| `ARGUS_LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration |
| `ARGUS_COLLECTORS` | `usgs,gdelt,rss,firms,gdacs,eonet,tsunami,nga,faa_tfr,sigmet,czib` | Collectors the worker runs |
| `ARGUS_AIR_ENABLED` | `true` | Poll military aircraft (adsb.fi, then adsb.lol) in the worker |
| `ARGUS_AIR_INTERVAL_S` | `30` | Seconds between military aircraft polls |
| `ARGUS_SPACE_ENABLED` | `true` | Fetch the CelesTrak satellite catalogue every six hours |
| `ARGUS_SEA_ENABLED` | `true` | Stream vessels from AISStream once a key is saved |
| `ARGUS_FIRMS_MAP_KEY` | (empty) | NASA FIRMS key; fires are off without it ([get one](https://firms.modaps.eosdis.nasa.gov/api/map_key/)) |
| `ARGUS_RSS_FEEDS_FILE` | (built-in list) | JSON file of `[{"outlet": "...", "url": "..."}]` replacing the default feeds |
| `ARGUS_USER_AGENT` | `Argus/0.1 (...)` | User-Agent sent to data sources |
| `ARGUS_NATS_URL` | `nats://nats:4222` | Message bus; empty turns live push off |
| `ARGUS_RAW_RETENTION_DAYS` | `30` | How long raw records and articles are kept |
| `ARGUS_EVENT_RETENTION_DAYS` | `30` | How long expired events are kept |

## Street map

The Dark map's street detail can come from your own server instead of Esri.
Argus downloads OpenStreetMap data for a region (from the daily
[Protomaps](https://protomaps.com/) build, transferring only that region)
and the `tiles` container renders it in the Argus Dark style. Outside the
region, Esri is used as before.

```bash
make streetmap                    # Tennessee (the default)
make streetmap REGION=southeast   # or tennessee, conus, planet
scripts/streetmap.sh custom -88.1,34.9,-81.6,36.7   # any W,S,E,N box
scripts/streetmap.sh conus --dry-run                # size only
```

| Region | Download |
|---|---|
| `tennessee` | 376 MB (measured) |
| `southeast` | a few GB |
| `conus` | tens of GB |
| `planet` | about 140 GB |

`--dry-run` prints the exact size for any region before downloading.

Data goes to `data/streetmap/` next to `docker-compose.yml` (fonts are
fetched once, about 14 MB). Run the same command again to update to the
latest build. Without data, the `tiles` container idles and nothing
changes.

Rendered tiles are cached by nginx (up to 2 GB, kept 30 days), so each
tile is drawn once. The street map is a server-wide setting: every user
sees the installed region. **Settings → Street map** shows what's installed.

Data © OpenStreetMap contributors (ODbL), credited on the map.

## Map imagery (Google)

**Settings → Map imagery** (under Administration) chooses where **Satellite**
and **Hybrid** imagery comes from, for every user:

- **Esri** (default): no key, fine for light use.
- **Google**: Google Maps Platform's Map Tiles API with your key. Hybrid adds
  Google's roads and labels. Turn on **Photorealistic 3D** to add a **3D**
  base map with Google's 3D buildings and terrain where Google has them.

The Dark map and the self-hosted street map are not affected.

To set it up:

1. In the [Google Cloud console](https://console.cloud.google.com/), enable
   the **Map Tiles API** for a project with billing, and create an API key.
2. Restrict the key: API restriction to the Map Tiles API, and an HTTP
   referrer (website) restriction to the address you open Argus at.
3. Paste it in **Settings → Map imagery**, choose **Google** and save.
   Argus checks the key with Google before saving it.

How the key is handled:

- It's stored encrypted with `ARGUS_SECRET_KEY` and shown to admins only as
  its last four characters.
- Signed-in browsers receive it, because they load Google's tiles directly
  from Google; that's why the referrer restriction matters.
- Google bills tile use beyond its free monthly allowance to the key's
  project, and using Google tiles means following the Map Tiles API terms.
- Changes are recorded in the audit log (`settings.imagery`), without the key.

## Data source keys

**Settings → Data sources** (administrators) holds keys for sources that
need one, stored encrypted with `ARGUS_SECRET_KEY` and used only by the
server, and shows how every source is doing.

| Key | Unlocks | Get one |
|---|---|---|
| AISStream | Live vessels (the Sea layers) | Sign in at [aisstream.io](https://aisstream.io/) with GitHub and create a key under **API Keys** (free) |
| openAIP | Airspace structure (restricted areas, CTRs, TMAs) | Make an account at [openaip.net](https://www.openaip.net/) and create an API client key under your profile (free, non-commercial) |

With a key saved, the worker holds one stream for the whole world, so all
users share it.

### Your own receivers

If you run an ADS-B or AIS receiver (an RTL-SDR on your network), add its
address under **Your receivers**:

| Receiver | Address |
|---|---|
| ADS-B | readsb or tar1090's `aircraft.json`, for example `http://192.168.1.50/tar1090/data/aircraft.json` |
| AIS | AIS-catcher's web server `ships.json`, for example `http://192.168.1.50:8100/api/ships.json` |

The worker polls the ADS-B one every 2 seconds and the AIS one every 10.
What they hear is merged into the map for everyone. The worker container
fetches them, so use the receiver's LAN address, not `localhost`.
