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
| `ARGUS_TLS` | (empty) | `self-signed` to serve HTTPS with a certificate Argus makes itself (see [Deployment](../technical/deployment.md#https-before-a-proxy-a-self-signed-certificate)) |
| `ARGUS_TLS_NAMES` | `localhost` | Names and IPs for that certificate, comma list |
| `ARGUS_TLS_REDIRECT` | `true` | With `ARGUS_TLS` and `ARGUS_HTTPS_PORT` set, send plain `http://` visitors to the HTTPS address (never the health check, nor requests a proxy marks `X-Forwarded-Proto: https`) |
| `ARGUS_HTTPS_PORT` | (unset) | Host port for HTTPS, for example `8443`; unset, the container's HTTPS port isn't reachable from outside |
| `ARGUS_TRUSTED_PROXIES` | (empty) | Reverse proxies in front of Argus (IPs or ranges, comma list) whose forwarded visitor address is believed; see [Deployment](../technical/deployment.md#real-visitor-addresses) |
| `ARGUS_REAL_IP_HEADER` | `X-Forwarded-For` | Header those proxies use; `CF-Connecting-IP` when Cloudflare connects directly |
| `ARGUS_LOG_LEVEL` | `INFO` | API log level |
| `ARGUS_SETUP_TOKEN` | random | Fixed setup token for automated installs |
| `ARGUS_SETUP_TOKEN_HOURS` | `24` | Setup token lifetime |
| `ARGUS_SESSION_IDLE_HOURS` | `12` | Idle session timeout |
| `ARGUS_SESSION_MAX_DAYS` | `7` | Absolute session lifetime |
| `ARGUS_SESSION_REMEMBER_DAYS` | `30` | Lifetime with "keep me signed in" |
| `ARGUS_LOGIN_MAX_FAILURES` | `5` | Failed sign-ins before lockout |
| `ARGUS_LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration |
| `ARGUS_COLLECTORS` | empty (all) | Collectors the worker runs, as a comma list: `usgs,gdelt,rss,firms,gdacs,eonet,tsunami,nga,faa_tfr,sigmet,czib,nws,spc,fema,nifc`. Empty runs every collector, including new ones after an update |
| `ARGUS_AIR_ENABLED` | `true` | Poll military aircraft (adsb.fi, then adsb.lol) in the worker |
| `ARGUS_AIR_INTERVAL_S` | `30` | Seconds between military aircraft polls |
| `ARGUS_GPS_SWEEP` | `true` | After each military poll, fetch one GPS interference hotspot (all aircraft within 250 nm) from adsb.fi for the GPS layer. Never uses adsb.lol |
| `ARGUS_SPACE_ENABLED` | `true` | Fetch the CelesTrak satellite catalogue every six hours |
| `ARGUS_SEA_ENABLED` | `true` | Stream vessels from AISStream once a key is saved |
| `ARGUS_FIRMS_MAP_KEY` | (empty) | NASA FIRMS key; fires are off without it ([get one](https://firms.modaps.eosdis.nasa.gov/api/map_key/)) |
| `ARGUS_RSS_FEEDS_FILE` | (built-in list) | JSON file of `[{"outlet": "...", "url": "..."}]` replacing the built-in feeds. Settings › News feeds is easier: an edited list there replaces both |
| `ARGUS_USER_AGENT` | `Argus/0.1 (...)` | User-Agent sent to data sources. Wikipedia and OpenStreetMap Nominatim (address search) ask automated clients to include a way to reach the operator and throttle generic ones, so add a URL or email for your server, for example `Argus/0.1 (ops@example.org)` |
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
make streetmap BBOX=-80.6,40.4,-71.8,45.1   # any W,S,E,N box (here New York State)
make streetmap REGION=southeast            # or conus, planet
scripts/streetmap.sh conus --dry-run       # size only
```

| Region | Download |
|---|---|
| a US state | a few hundred MB (Tennessee measured 376 MB) |
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

## Defaults for everyone

Settings > **Defaults** (admins) sets what every user starts with; each
user can still change their own:

- **Layers and filters:** set your own map the way you want it, then
  **Use my current map layers**. New users open the map with those layers,
  and **Reset filters** returns to them. **Use built-in** goes back to
  Argus's own defaults.
- **News tabs:** tick the channels that get a tab and order them with the
  arrows. Users who haven't picked their own tabs get these.
- **Video:** whether streams start muted, and their volume. Users can
  override both in Settings > Display > Video. Browsers may keep a stream
  muted until someone clicks on the page.
- **Brief sections:** the order the Brief's sections start in, and which
  are switched off, for users who haven't customized their own. Arrange
  them here, or set your own Brief with **Customize** and use **Use my
  current Brief**. **Use built-in** goes back to US first, then the
  world. A user's **Reset to default** on the Brief returns them to this
  order.

## News feeds and live channels

Settings › **News and video** (admins) holds both lists. Each starts as
Argus's built-in list; once you change anything, your list is used
instead, and **Reset to built-in** goes back (and picks up feeds or
channels later releases add).

- **News feeds:** the RSS and Atom feeds the server reads every ten
  minutes, grouped by section, with a filter. **Add feed** takes the
  outlet's name, the feed's address (not the web page), a section and
  where the outlet is based (the US or elsewhere, which helps tell US top
  stories from world ones). **Test** fetches it and shows the headlines
  Argus reads before you save. Switch a feed off to stop reading it
  without losing it. A **failing** badge means its last fetch failed.
  Sections say what a feed covers (World, US, Politics, UK, Business to
  start with); change one feed's with **Edit**, or a whole section's with
  **Rename** on its header (renaming to an existing section merges them).
- **Live channels:** the channels the news player, the News page and the
  Wall offer, in order. Paste a YouTube channel link, a `@handle`, a
  channel ID or a Rumble channel link and **Look up**: Argus finds the
  channel's ID and name and says whether it's live now. Set its tab label
  and group, then **Add channel**. **Check live**, **Edit**, the arrows
  and **Remove** work on each one. Only add channels with a true live
  stream (around the clock, or a live TV simulcast).

## Wall displays

To put the Wall on a TV, a Raspberry Pi in kiosk mode or a spare PC
without typing a password on it:

1. On the screen, open `https://your-argus/pair` (or **Pair it as a wall
   display** under the sign-in form). It shows a 6-character code. Nobody
   signs in on the screen. A browser that's already signed in shows how
   to sign out first instead.
2. On your own device, open Settings > **Displays**, enter the code and a
   name ("Ops room TV"), and press **Pair**.
3. Within a few seconds the screen signs itself in and opens the Wall.

Each screen gets its own *display* account: it can only see the Wall, its
session doesn't time out when idle, and no password is kept on the device.
The session renews itself while the screen is showing the wall, so it
stays paired indefinitely. After a power cut or restart, the screen goes
straight back to the wall as long as its browser opens your Argus
address on start (set that as the kiosk or start-up page); its layout,
channels and sound come from the server, and the tour starts again from
its first stop. A screen left switched off for more than 30 days needs
pairing again.
**Wall settings** next to a screen sets what it shows: its home (for the
home stop, home clock and night dimming), the tour, seconds per stop,
critical-event interruptions, map layers, sections, news and clocks, or
a shared [wall profile](../using/map.md#wall-profiles) for screens that
should show the same thing (see [the Wall](../using/map.md#wall)).
Saving pushes the change to the screen within about 10 seconds; **Sync**
next to a screen (or **Sync all now**) does the same on demand, and
**Reload** (or **Reload all**) reloads the page, after an update or if a
screen looks stuck. The screen picks changes up within a
minute; nothing needs re-pairing. **Unpair** in Settings > Displays signs
it out at once and disables its account. Codes last ten minutes; the screen fetches a new one when its
code runs out.
