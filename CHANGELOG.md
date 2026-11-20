# Changelog

All notable changes to Argus. Versions follow [Semantic Versioning](https://semver.org/):
a new major version may need you to change something when you upgrade, minor versions add
features, and patch versions fix things. Upgrade with `./argus update`.

## [1.0.0] - 2026-11-20

The first release: everything Argus does, on one self-hosted globe.

### Map

- 3D globe and 2D world map (CesiumJS) opening at your home, with dark, satellite and hybrid
  base maps, optional Google imagery and a self-hosted OpenStreetMap street map.
- Country, state and place labels, hover cards and a legend for whatever's on, a timeline you
  can replay, share links, PNG capture, and map tools to select an area and export it, draw,
  measure and add notes.
- Universal search: flights, hex and tail numbers, airports, places, coordinates, events,
  layer words like `tankers`, and street addresses (OpenStreetMap Nominatim).
- Recent Sentinel-2 (optical) and Sentinel-1 (radar) imagery for a drawn box, with a
  before-and-after split.
- Saved camera tours with captions (director mode), shareable as links.

### Events and news

- Earthquakes (USGS), conflict and protest reports (GDELT), fires (NASA FIRMS), disasters (GDACS,
  NASA EONET), US tsunami warnings, NGA navigational warnings and Wikipedia's current events.
- Fusion and corroboration: GDELT reports stay unconfirmed until several outlets report the same
  kind of event and news headlines back them. Crime, crash and court stories aren't promoted,
  and articles whose links aren't about violence or unrest never count.
- Headlines from 34 outlets (44 feeds) across the spectrum, matched to events.
- A world tension index per country and theatre, anchored to UCDP conflict data.
- A live news player with 18 channels that stream around the clock, plus Ryan Hall, Y'all for
  major weather events.

### Air, sea and space

- Military aircraft worldwide and civil traffic for the view (adsb.lol, adsb.fi), routes and
  progress, follow, chase, orbit and cockpit views with head-up displays, and 3D models.
- Ships from AISStream with bridge view, ports, and your own ADS-B and AIS receivers.
- About 17,000 satellites moved live with SGP4, passes over home, the ISS in 3D.
- Rocket launches at their pads (Launch Library 2) and space weather (NOAA SWPC).
- Patterns: military orbits and racetracks, and ships loitering on submarine cables.

### Airspace, weather and infrastructure

- FAA flight restrictions, SIGMETs, EASA conflict zone bulletins, openAIP restricted areas and
  control zones, GPS interference from ADS-B accuracy, and air-raid alerts for Ukraine (by
  oblast) and Israel (by locality).
- FAA ground stops and delays at US airports.
- NWS warnings, watches and advisories on their zone outlines, the SPC outlook, satellite clouds
  and precipitation, and conditions at home.
- Power plants, submarine cables, military bases, plate reader cameras (OpenStreetMap), US and UK
  travel advisories, internet outages (IODA), ransomware claims per country and CISA's newly
  exploited vulnerabilities.
- Traffic cameras (Caltrans, TDOT, DriveBC, London, Finland) with live video and estimated
  viewsheds, Windy webcams and live YouTube near the view or about an event.

### Brief, Wall and alerts

- The Brief: theatres, top events, changes since yesterday, Wikipedia, space weather,
  exploited vulnerabilities and an optional AI digest.
- The Wall for screens paired with a code: tours or live TV (up to four channels), layers and
  sections, shared profiles, changes pushed within seconds, sessions that renew themselves.
- Alerts: your own rules (events near home or in a drawn area, air-raid alerts, ground stops,
  patterns, a watchlist, geomagnetic storms), delivered to the bell, ntfy and webhooks
  (Discord, Slack, JSON), with quiet hours.

### AI (optional)

- Bring your own model (Anthropic, OpenAI or an OpenAI-compatible local server such as Ollama)
  for a cited Brief digest, event summaries and Ask Argus, with encrypted keys, a monthly token
  cap and usage counts.

### Running it

- First-run setup with a one-time token, accounts with roles (admin, analyst, viewer, display),
  Argon2id passwords, CSRF protection, lockout, rate limits and an audit log.
- Backups and restore from Settings or the command line, `./argus update`, the `./argus` CLI,
  real visitor addresses behind a reverse proxy, optional self-signed HTTPS, and built-in
  documentation with search at `/docs/`.
- `make release VERSION=X.Y.Z` to cut a release.

[1.0.0]: https://github.com/twillislabs/argus/releases/tag/v1.0.0
