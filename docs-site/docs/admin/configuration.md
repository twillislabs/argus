---
title: Configuration
---

# Configuration

All settings are environment variables, usually set in `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `ARGUS_SECRET_KEY` | (must set) | Encrypts stored keys in later milestones |
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
| `ARGUS_COLLECTORS` | `usgs,gdelt,rss,firms` | Collectors the worker runs |
| `ARGUS_AIR_ENABLED` | `true` | Poll military aircraft from adsb.lol in the worker |
| `ARGUS_AIR_INTERVAL_S` | `15` | Seconds between military aircraft polls |
| `ARGUS_FIRMS_MAP_KEY` | (empty) | NASA FIRMS key; fires are off without it ([get one](https://firms.modaps.eosdis.nasa.gov/api/map_key/)) |
| `ARGUS_RSS_FEEDS_FILE` | (built-in list) | JSON file of `[{"outlet": "...", "url": "..."}]` replacing the default feeds |
| `ARGUS_USER_AGENT` | `Argus/0.1 (...)` | User-Agent sent to data sources |
| `ARGUS_NATS_URL` | `nats://nats:4222` | Message bus; empty turns live push off |
| `ARGUS_RAW_RETENTION_DAYS` | `30` | How long raw records and articles are kept |
| `ARGUS_EVENT_RETENTION_DAYS` | `30` | How long expired events are kept |
