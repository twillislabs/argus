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
