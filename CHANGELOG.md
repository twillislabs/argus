# Changelog

All notable changes to Argus. Versions follow [Semantic Versioning](https://semver.org/):
a new major version may need you to change something when you upgrade, minor versions add
features, and patch versions fix things. Upgrade with `./argus update`.

## [Unreleased]

### Interface

- Source health (each collector's last pull and status) is for
  administrators only: other people no longer see the Brief's Source
  health section, can't turn it on in Customize, and don't get the
  status dots on the layer rows.

## [1.9.2] - 2026-11-23

Flight routes that match the leg being flown, and phone fixes. Nothing
to change when you upgrade; to get the new Home Screen icon on an
iPhone, remove Argus from the Home Screen and add it again.

### Phones

- Signing in no longer leaves the app zoomed in on iPhones: Safari
  zooms into any field set under 16 px when you tap it, so fields are
  16 px on phones.
- The alerts dropdown fits the screen: under the bell with a margin
  either side, instead of hanging off the left edge.
- The Home Screen icon fills its tile. The web app manifest listed the
  see-through SVG icon, which iOS drew small on white; it now lists only
  the full-square PNGs. If you added Argus before, remove it from the
  Home Screen and add it again: iOS keeps the old icon.

### Aircraft

- Flight routes are looked up in Virtual Radar Server's route data
  (served by adsb.lol) as well as adsbdb and hexdb, so flight numbers
  airlines reuse across the day show the leg actually being flown (for
  example Southwest 532, Nashville to Cleveland, not an old Baltimore to
  Providence leg).
- When no route on file fits the aircraft, the panel says the route is
  unknown instead of showing the wrong one.

## [1.9.1] - 2026-11-23

A fix for the home marker, and a street map for the whole US. Nothing
to change when you upgrade.

### Map

- The HOME marker and its label hide when your home is on the far side
  of the globe; they used to show through it.

### Street map

- `make streetmap REGION=us` downloads the whole US: the lower 48,
  Alaska and Hawaii, without the ocean and Canada between them
  (about 20 GB). `BBOX` takes several boxes separated by `;`.

## [1.9.0] - 2026-11-23

Zoom in on space stations and capsules, 3D models of real spacecraft
and rockets, and a clearer sign-in globe. Nothing to change when you
upgrade.

### Space

- Zoom right in on space stations, capsules and rocket stages, as with
  aircraft: following one now moves the camera every frame, and the
  wheel (or a pinch) closes in to just outside the model.
- New 3D models: Crew Dragon (open nose cone, thrusters, windows, heat
  shield, trunk with solar cells and fins), Soyuz and Progress,
  Shenzhou, cargo ships (Tianzhou, Cygnus), Tiangong and spent upper
  stages, in colour. Vehicles near a station are drawn docked to it.
- Launch pads with a launch coming show a 3D model of the rocket up
  close: Falcon 9 (with Dragon on crew and cargo flights), Falcon
  Heavy, Starship, New Glenn, Vulcan, Atlas V, Ariane 62 and 64,
  Soyuz, Long March (with and without boosters, and the crewed 2F),
  Electron and small solid launchers, at their real sizes, else a
  generic rocket. Double-click the pad to orbit round it.
- Clicking away from a followed station now lets go of the camera; it
  used to stay locked on the station until Home or World.

### Interface

- Wall left the toolbar: it's for display screens. **Open wall view**
  in the account menu opens it in a new tab.
- The Make token and backup buttons no longer stretch across the form.

### Sign-in

- The sign-in globe has more contrast: the sea takes the theme's
  accent, land is lighter and coastlines are outlined.

### Weather

- The weather loop's clock shows your home's time when you've set a
  home, and UTC otherwise.

## [1.8.0] - 2026-11-23

A smoother phone layout, and aircraft off in the built-in layers.
Nothing to change when you upgrade: people who already chose their own
layers, and any server default an admin set, keep them.

### Map

- Aircraft start off: military aircraft are no longer on by default
  (civil traffic never was). Turn them on in Layers, or make them
  everyone's in Settings › Defaults. People who already chose their
  layers keep them.
- Settings › Defaults says right by the button when the default layers
  are saved (the message used to be at the bottom of the page).

### Phones

- Smoother on phones: the Layers and Situation panels slide up as
  sheets with a handle (drag up or tap for full height, down to close),
  the header fits on one line, each row of map tools is a strip you
  swipe sideways instead of running off the screen, the timeline's
  chart gets the full width, and Settings shows its menu and each
  section as pages of their own. Taps respond at once, without the grey
  flash, and panels scroll without moving the page.

## [1.7.0] - 2026-11-23

Sign-ups with optional approval, user groups and feature access, and
wall improvements (Identify, autosave, the side column filling in).
Migrations 0011 and 0012 run on start. Sign-ups stay off until an admin
turns them on, and nothing is limited until an admin sets it.

### Wall

- **Identify** (Settings › Displays) shows a screen's name across that
  screen for about 25 seconds, to tell screens apart. Displays lists each
  screen's account, and Users & roles labels display accounts with their
  screen.

- With live news off, the wall's side panels fill the column and Top
  events lists up to 14 instead of 5.
- Wall settings save by themselves (Settings › Displays and Display ›
  Wall); before, a change left unsaved at the bottom of the form never
  reached the screen.
- Weather at home on a screen with no home location says so, on the
  wall and in its settings, instead of showing nothing.

### Accounts

- User groups, and limiting features to chosen groups and people
  (Settings › Users & roles › Groups and Feature access): AI, alerts,
  API tokens and AI assistants, and live video search can each be
  open to everyone whose role has it or only to those you choose.
  Administrators always keep everything; limited API tokens stop
  working at once.

- Sign-ups (Settings › Users & roles): admins can let people make their
  own accounts from the sign-in page, optionally waiting for an admin to
  approve them (Approve and Decline in the accounts list, a count in the
  Settings menu), with the role new accounts get. Off by default.

## [1.6.0] - 2026-11-23

Themes (including Cassette Futurism and Cyberpunk) with custom themes,
Dailymotion and Kick live video, double-click to focus anything, Google
Street View, a weather loop, and comparing a story across outlets.
Nothing to change when you upgrade. Optional new keys in Settings ›
Data sources: Mapillary (street photos inside Argus).

### Weather

- **Loop the last hour** (Weather layers): radar and clouds play the
  last hour in 10-minute frames, so you see storms and cloud move, with
  the frame's time on the map.

### News

- Brief top stories: click a story to compare outlets. Every outlet's
  headline for it is listed, each linking to that outlet's article, so
  you choose which version to read.

### Street view

- **Street view here** (right-click the map) replaces Street photos: it
  always offers Google Street View for the spot (no key; it covers
  almost every US road), and with a free Mapillary token (Settings ›
  Data sources) shows Mapillary's street-level photos inline. Panoramax
  is gone: it covered mostly France.

### Situation

- World tension explains itself for newcomers: **What is this?** under
  the score, and a country's hover card and panel now give its band,
  deaths over the year and the change on the year before, what live
  events add, and how today compares with normal.

### Themes

- Themes: Argus Dark (still the default), Cassette Futurism, Cyberpunk,
  Hologram, Vector, Night Ops and Daylight. Each changes the whole look
  (colours, fonts, corners, glow, a screen overlay, the header and the
  dark map), not just colours. Pick yours in Settings › Display; admins
  set everyone's default in Settings › Defaults, which the sign-in and
  pairing pages use too.
- Custom themes: admins make their own in Settings › Themes from a
  built-in one (colours, fonts, corners, glow, overlay, stripe), with a
  live preview and JSON to copy or paste. The format is documented in
  Using Argus › Themes.
- The pairing page has the sign-in page's look, with the globe behind
  the code.

### Video

- Live near the view searches Dailymotion too, without a key: live
  streams naming the area's biggest places, then the live channels based
  in that country. It now finds something even without a YouTube key.
- Live channels can be on Dailymotion or Kick as well as YouTube and
  Rumble (Settings › Live channels).

### Map

- Double-click focuses: aircraft, ships and satellites are followed as
  before, events flown to, and now everything else on the map (cameras,
  radio stations, fires, storms, airports, launches and so on) is
  selected and flown in to. Double-clicking bare map zooms in on that
  spot.

### Cameras

- The traffic camera picture in 3D moved from the layer list to
  Settings › Display (**Traffic camera picture in 3D**), still off by
  default.

## [1.5.0] - 2026-11-23

Wildfire outlines, Global Fishing Watch at sea, sharp imagery close-ups
anywhere, clickable pattern rings and a livelier sign-in page. Nothing
to change when you upgrade; Global Fishing Watch needs its own free
token in Settings › Data sources if you want that layer.

### Hazards

- Wildfire outlines (US): the mapped edge of every current wildfire of
  100 acres or more, from NIFC (public domain, no key), paler once
  mostly contained; click one for its event.

### Sea

- Ships meeting at sea, loitering and AIS gaps (ships going dark) from
  Global Fishing Watch, for a regional view over the last 30 days. Needs
  a free Global Fishing Watch token (non-commercial) in Settings › Data
  sources.

### Cameras

- The camera you're looking at is ringed on the map.
- The camera's picture in the 3D scene is now a layer toggle, **Camera
  picture on the map**, off by default.

### Interface

- The sign-in page says "Sign in to Argus" rather than "Welcome back",
  for people signing in for the first time.
- A livelier sign-in page: the globe now fills the background behind
  the form, dimmed, with day and night, flights tracing between cities,
  satellites on their orbits and a radar sweep, a live UTC readout and
  what Argus watches. Phones get it too instead of a plain form.
- The documentation links to the GitHub repository (navbar, footer and
  introduction).
- Layer descriptions mention keys only when one is missing, and the
  traffic cameras row no longer names only Caltrans and TDOT.

### Imagery

- Recent imagery close-ups everywhere: past street level, Esri World
  Imagery takes over from Sentinel's 10 m pixels (with NAIP in the US,
  the newer of the two on top), and the panel gives each one's source,
  detail and date.

### Patterns

- The orange and red pattern rings can be clicked and hovered: they
  open the circling aircraft or loitering ship, whose panel and hover
  card now say what it's doing (for example 2.3 laps in 40 min).

### Fixed

- Recent imagery no longer disappears when you switch the base map.

## [1.4.0] - 2026-11-21

Assistants can read the map through MCP, plus world radio, live public
transport, street photos, sharper close-ups in the US and about 3,200
more traffic cameras. Nothing to change when you upgrade: the new API
tokens table is added on start.

### AI assistants

- An MCP server at /api/mcp, so Claude and other assistants can read
  the situation, events, search, weather and air quality, aircraft,
  ships, traffic cameras and news. It uses read-only API tokens, made
  in Settings › AI assistants.

### Imagery

- Recent imagery: close up in the US, NAIP aerial photos (about 0.6 m)
  take over from Sentinel's 10 m pixels, with the date they were flown.

### Ground

- Radio stations: about 1,300 of the world's most-played stations on
  the map (Radio Browser, no key); click one and press Listen.
- Street photos here (right-click): the nearest street-level photos
  from Panoramax, with their author and licence, no key.
- Public transport, live: buses, trams, metros, trains and ferries in
  Boston, Denver, Toronto, Calgary, Edmonton, Victoria BC, Helsinki,
  the Netherlands and South East Queensland, from the operators' open
  GTFS-Realtime feeds (no keys).

### Space

- Satellite passes show the directions a satellite rises and sets in,
  and mark passes you can see with the eye (sunlit against a dark
  sky). They can be worked out for the map's centre as well as home.

### Cameras

- About 3,200 more traffic cameras, no keys needed: Austin, King County
  (WA), Delaware (live video), Toronto, Calgary, Norway (some live
  video) and Iceland.
- The selected traffic camera's picture on the map: at the end of a
  3D view cone (View along it flies to just behind the camera), or
  floating above cameras with no known direction.

## [1.3.0] - 2026-11-20

Animated wind and air quality worldwide, traffic cameras in Texas,
Washington and Hong Kong, and camera badges that keep busy maps
readable. Nothing to change when you upgrade.

### Weather

- Animated wind worldwide (NOAA GFS, no key): streaks coloured by
  speed, on their own canvas so the globe still redraws only when
  something changes. Also on the Wall.
- Air quality (Open-Meteo, CAMS, no key): a US AQI tint with the index
  on each point for the view, and an Air quality section in Weather
  here.

### Cameras

- Traffic cameras in Texas (TxDOT, about 3,500), Washington (WSDOT,
  about 1,600) and Hong Kong (about 1,000), no keys needed.
- Zoomed out, nearby traffic cameras, webcams and plate reader
  cameras merge into a badge with their count; click it to zoom in
  to them.

## [1.2.0] - 2026-11-20

Keyless weather extras, Argus on phones, a cooler-running map and
news settings you can organise. Argus is now licensed under the
Apache License 2.0.

### Upgrading

- `make streetmap` no longer has a default region: give `REGION=` or
  `BBOX=W,S,E,N`.

### Weather

- Tropical storms worldwide (GDACS): track, forecast cone and wind
  swath, coloured by strength, on by default.
- New layers from NOAA nowCOAST: US radar, lightning, water vapour and
  sea temperature.
- An opacity slider for each weather imagery layer.
- Weather here: right-click the map for any spot's weather now, the
  next 24 hours and 7 days, and NWS alerts there in the US.
- The Wall can show the new weather layers.

### Performance

- The map no longer redraws every display frame while nothing moves:
  it renders at full speed while you move it or follow an aircraft, and
  about ten times a second otherwise, so computers run much cooler.
  Settings > Display > Map frame rate picks Smooth (every frame),
  Balanced (the default) or Power saver (about twice a second).
- Satellites aren't propagated while the tab is hidden.

### Phones

- Argus works on phones: the map fills the screen, with Layers and
  Situation as sheets over it from a tab bar, a compact header and map
  controls that fit; tables scroll inside their cards and the Wall
  stacks.
- Icons for phones and browsers (Apple touch icon, Android and maskable
  icons, favicon.ico) and a web app manifest, so Argus can be added to
  a home screen.

### News and video

- Feed sections and live channel groups can be added, reordered,
  renamed and deleted, and the section or group of a feed or channel is
  picked from a list (or a new one typed).
- Live videos found near the view or about an event play again
  (YouTube error 153), and pop out into their own window like the news.

### Project

- Licensed under the Apache License 2.0: use, modify and share it
  freely, keeping the NOTICE file that credits the original project.
- The docs use neutral examples, not one install's hosts or region.

### Fixes

- The New profile form's Add button no longer stretches across the
  card; the pairing code box is wider and formats the code as you type.

## [1.1.0] - 2026-11-20

More US coverage, events that match their sources, and news you can
configure.

### Upgrading

- `ARGUS_COLLECTORS` now runs every collector when it's empty or unset,
  and Docker Compose and `.env.example` no longer pin a list. If your
  `.env` sets it, the new collectors (`fema`, `nifc`) and the NWS ones
  (`nws`, `spc`) only run if you add them: either delete the line from
  `.env` or add them to it, then `./argus update`.

### Events

- One story per event: articles and headlines are compared by their
  words (weighted by how rare they are that day), so each article
  belongs to one event, an event keeps the story most outlets tell, the
  same story reported in two places becomes one event (Kyiv strikes
  GDELT pinned on Moscow), and a headline only backs an event that
  tells its story. Off-topic articles come out of events.
- Confirmed events are titled with the headline that backs them;
  opinion and question headlines never back an event.
- Incidents: a new layer for crime and public-safety events, confirmed
  when national outlets carry them (a mass shooting, a terror plot), so
  everyday local crime stays unconfirmed.
- Headline-led events: three or more outlets running one story about
  something happening in a US city or state (a derailment, an
  evacuation, nationwide outages) make an event there.
- US disasters: FEMA disaster and emergency declarations, NIFC wildfires
  not yet contained, and the most serious NWS warnings (tornado,
  hurricane, flash flood emergency...) while they're in force.
- Ship sanctions: ships on sanctions, shadow-fleet and war lists
  (OpenSanctions) get a red ring and a Sanctions and risk section, and
  an alert kind.

### Brief

- US top stories and world top stories: the day's headlines grouped by
  story, ranked by how many outlets run them.
- US events and world events, US first by default.
- Customize reorders and hides sections for your account; admins set
  the default in Settings › Defaults.

### Settings

- News feeds: add, test, edit, switch off and remove RSS and Atom feeds,
  grouped in sections you can rename.
- Live channels: add YouTube or Rumble channels from a link, `@handle` or
  ID (looked up for their name and whether they're live), with groups,
  tab labels and order.
- The menu is grouped (You, Map and data, News and video, People and
  screens, System) and has a search box.

### Map

- Recent imagery is twice as sharp (512 px tiles), and Capture saves the
  map at twice the screen's resolution.
- Box and circle tools show a dashed outline until the second click.
- Rocket launches link to their webcasts, mission pages and Space Launch
  Now, not just Wikipedia.

### Fixes

- Live near the view found no YouTube streams: the strict safe-search
  setting drops every live stream.
- The Ask button didn't appear after Ask was turned on until a reload.
- The Brief showed an old order after you customized it and came back.
- `./argus update` fetches release tags.

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

[1.2.0]: https://github.com/twillislabs/argus/releases/tag/v1.2.0
[1.1.0]: https://github.com/twillislabs/argus/releases/tag/v1.1.0
[1.0.0]: https://github.com/twillislabs/argus/releases/tag/v1.0.0
