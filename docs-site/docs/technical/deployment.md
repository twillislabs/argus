---
title: Deployment and networking
sidebar_position: 8
---

# Deployment and networking

## Ports

| Port | Where | Exposed to host? |
|---|---|---|
| `ARGUS_HTTP_PORT` (default 8080) → `web:80` | nginx | **yes**, the only one |
| `api:8000` | uvicorn | no |
| `db:5432` | PostgreSQL | no |
| `nats:4222`, `nats:8222` | NATS client, monitoring | no |
| `tiles:8080` | tileserver-gl (street map) | no; nginx serves `/tiles/` |

To reach the database from the host while developing, add a temporary
`ports:` entry or use `docker compose exec db psql -U argus`.

## Behind a reverse proxy (recommended)

Terminate TLS in front of `web`, for example with Caddy:

```text
argus.example.lan {
    reverse_proxy 127.0.0.1:8080
}
```

Keep `ARGUS_COOKIE_SECURE=true` whenever browsers reach Argus over HTTPS.

### HTTPS before a proxy: a self-signed certificate

Sign-in cookies are Secure by default (`ARGUS_COOKIE_SECURE=true`), and
browsers only keep Secure cookies over HTTPS (or on `localhost`): on a
plain `http://` address the password is accepted but the browser drops
the session, and the sign-in page says so. Until a reverse proxy with a
real certificate is in front, Argus can serve HTTPS itself:

```text
ARGUS_TLS=self-signed
ARGUS_TLS_NAMES=192.168.1.20,argus,argus.lan   # how people reach it
ARGUS_HTTPS_PORT=8443
```

then `make up` and open `https://192.168.1.20:8443`. The browser warns
once about the self-signed certificate; accept it and sign in. The
certificate is made on first start and kept in the `web-tls` volume (so
the exception stays valid across rebuilds); changing `ARGUS_TLS_NAMES`
makes a new one. Plain HTTP on `ARGUS_HTTP_PORT` keeps working, for the
proxy to use later. On a trusted LAN you can instead set
`ARGUS_COOKIE_SECURE=false` and use plain HTTP.

### Real visitor addresses

Argus limits sign-in attempts per address and records addresses in the
audit log, so it needs each visitor's own address, not the proxy's. Its
nginx only believes a forwarded address from proxies you name:

| Setting | Meaning |
|---|---|
| `ARGUS_TRUSTED_PROXIES` | Comma-separated IPs or ranges of the proxies in front of Argus, as `web` sees them. Empty (the default): every connection is taken at its own address |
| `ARGUS_REAL_IP_HEADER` | The header those proxies put the visitor in: `X-Forwarded-For` (default), or `CF-Connecting-IP` when Cloudflare connects to Argus directly (for example a Cloudflare Tunnel) |

Whatever a client sends itself is never passed on: nginx tells the API
one address, `$remote_addr` after this check. Docker's port mapping makes
a proxy on the same host appear as the bridge gateway (typically in
`172.16.0.0/12`); `docker compose logs web` prints how many ranges are
trusted when it starts.

### nginx and Cloudflare in front

With Cloudflare in front of an nginx on the Docker host, which proxies
to Argus on `127.0.0.1:8080`:

1. In that nginx, take the visitor from Cloudflare (only for Cloudflare's
   own addresses; the list is at `https://www.cloudflare.com/ips/`), and
   pass it, the host and WebSocket upgrades on:

   ```nginx
   # http {} level: Cloudflare's ranges, kept up to date.
   set_real_ip_from 173.245.48.0/20;   # ... and the rest of the list
   real_ip_header CF-Connecting-IP;

   server {
       server_name argus.example.org;
       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto https;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
           proxy_read_timeout 1h;   # the live feed is a long WebSocket
       }
   }
   ```

   (`$connection_upgrade` is the usual `map $http_upgrade` to `upgrade`
   or `close`.)
2. In Argus's `.env`: `ARGUS_TRUSTED_PROXIES=172.16.0.0/12` (the Docker
   bridge the host nginx arrives through) and `ARGUS_COOKIE_SECURE=true`.
3. In Cloudflare: keep WebSockets on; turn off Rocket Loader and any
   other script or HTML rewriting (Argus's Content-Security-Policy blocks
   injected scripts); leave caching to Argus's headers (`/api` is
   `no-store`).

Argus has no hard-coded hostnames: pages use relative paths, and share
and pairing links are built from the address the browser used. The
WebSocket checks that the page's origin matches `Host`, so the proxies
must pass `Host` through unchanged.

## Data and backups

| Volume | Contents |
|---|---|
| `argus_db-data` | PostgreSQL data directory |
| `argus_nats-data` | JetStream storage (safe to lose; it is a buffer) |
| `./data/streetmap/` (bind mount) | Street map region and fonts; re-download with `make streetmap` |

nginx's rendered-tile cache lives inside the `web` container and refills on
its own after a rebuild.

`make backup` and `make restore` back up and restore the database and
`.env` together (scripts/backup.sh, scripts/restore.sh); see
[Backups and moving servers](../admin/backups.md).

## Health checks

| Service | Check |
|---|---|
| db | `pg_isready -U argus -d argus` |
| api | `GET /api/health` (includes a `SELECT 1`) |
| web | `GET /healthz` |

Compose starts `api` only after `db` is healthy, and `web` only after `api`
is healthy.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Checks |
|---|---|
| backend | ruff lint and format, pytest |
| migrations | `alembic upgrade head`, `alembic check` and `downgrade base` against PostgreSQL |
| frontend | `tsc` type check and production build |
| docs | Docusaurus build (fails on broken links) |
