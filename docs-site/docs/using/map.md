---
title: The map
---

# The map

## Base maps

Choose the base map with the **Dark / Satellite / Hybrid** buttons at the top
left of the map. Your choice is remembered.

| Base map | What you see | Source |
|---|---|---|
| **Dark** (default) | Graphite countries, borders and a faint graticule on a near-black ocean. Below about 3,000 km a dark street map with labels fades in, down to street level. | Natural Earth shapes bundled with Argus. Zoomed in: the self-hosted street map inside the installed region, Esri Dark Gray Canvas elsewhere |
| **Satellite** | Aerial and satellite imagery down to about 0.3 m per pixel in many cities, like Google Maps. | Esri World Imagery over NASA Blue Marble |
| **Hybrid** | Satellite with roads, borders and place names on top. | Esri World Imagery and reference layers |
| **3D** (when enabled) | Google's photorealistic 3D buildings and terrain. | Google Map Tiles API |

If an administrator added a Google key, **Satellite** and **Hybrid** use
Google's imagery instead of Esri's, and the **3D** button may appear.

The Esri services are hosted and need no key for light personal use.

### The self-hosted street map

Inside the region your administrator installed (see
[Configuration](../admin/configuration.md#street-map)), the Dark map draws
streets, buildings and labels from OpenStreetMap data on your own server, in
Argus colours and sharp down to street level. Outside that region it falls
back to Esri's dark map, toned to match. The street map is server-wide:
every user sees the same installed region.

## Moving around

- **Drag** to pan, **scroll** or pinch to zoom, **right-drag** or Ctrl-drag
  to tilt.
- **⌂** flies home. **◎** shows the whole world centred on your longitude.
  **↶** (or **B**) goes back to where you were before the last jump (home,
  world, a search result or an event), up to ten steps.
- **TOP** (or **T**) looks straight down, **35°** (or **O**) tilts to an
  oblique view and **N↑** (or **N**) turns north up, all around the point at
  the centre of the screen.
- **🔗 Copy link** copies a link to the current view: camera, base map,
  layers and the selected event or aircraft (with its camera view). Whoever
  opens it, after signing in, sees the same picture; their own saved
  layers aren't changed.
- **3D Globe / 2D World** switches between the globe and a flat map.
- **[** and **]** collapse the layer panel and the situation panel.
- **Hover** over anything on the map for a card with what it is and its
  key facts; click for the full details.
- **Right-click** the map to copy the spot's coordinates (decimal,
  degrees or MGRS) or centre the map on it. Every **Position** in the side
  panel has a ⧉ button that copies it.
- **Double-click** an event to zoom in on its area, or an aircraft, ship or
  satellite to follow it.
- **Esc** leaves an aircraft view, then closes the event or aircraft and
  returns to the situation panel.
- **Ctrl K** (⌘ K on a Mac) or **/** jumps to the search box.

Along the bottom of the map, the **readout** shows the MGRS grid reference
and latitude/longitude under the cursor and the camera's eye altitude, with
a **scale bar** on the right.

## Timeline

Under the map, the timeline charts events across the time window (from
the layer panel's **Time window**), coloured by layer:

- **Click or drag** on it to see the map as it was then: only events
  first seen by that moment are shown, and the bar at the top says
  **REPLAY**.
- **▶** plays forward at the chosen speed (1 minute to 6 hours of history
  a second) and loops within the window.
- **Shift-drag** picks a time range: the map shows only events first seen
  inside it, and play loops within it. Double-click the timeline to clear
  the range.
- **Live** returns to now.

Aircraft and ships stay live during replay; Argus doesn't keep their
history yet.

A green **UNCLASSIFIED // OPEN SOURCE** strip can be shown at the top from
Settings > Display (off by default).

Distances, lengths and heights are in **imperial** units (miles, feet) by
default; switch to metric in Settings > Display. Aircraft altitude and
speed stay in feet and knots, and ship speed in knots, either way.

## Brief

**Brief** in the top bar is a one-page overview for the start of a shift:

- **Theatres** (Middle East & Red Sea, Eastern Europe, Sahel, Indo-Pacific,
  Americas): tension, change over 24 hours, a two-week trend of live
  activity and the top event or most affected countries. Click one to
  open the map there.
- **Top events · 24h** by severity, **Changes since yesterday** in plain
  sentences, **Source health** for every collector and **Tension by
  country**.
- **Wikipedia current events** for the latest day, grouped as Wikipedia
  groups them (armed conflicts and attacks, politics, disasters...), with
  each entry's story thread and news sources. Click an entry to open the
  map at its place.

It refreshes every two minutes.

## Wall

**Wall** (`/wall`) is a hands-free layout for a screen at the back of the
room, readable from a few metres away:

- The map tours your home, then each theatre (most tense first), 25 seconds
  a stop, with a caption showing the theatre's tension and top event. A
  new critical event interrupts the tour, flies to the event and holds it
  for a minute. The tour, its timing and the layers can all be changed
  (below).
- The right column shows world tension, events, military aircraft,
  critical events and GPS jam cells in large type, the top five events and
  a live news channel.

Settings > Display > **Wall** sets how the Wall looks when you open it;
each paired screen has the same settings of its own under Settings >
Displays (**Wall settings** next to the screen):

- **Tour:** any mix of home, every theatre, one theatre, or places. Add a
  place by searching for it, typing coordinates, or pasting a map link
  (the Map's share button) to use that exact view; choose City, Region,
  Country or Continent zoom for searched places. Reorder with the arrows.
  Leave a single stop to keep the screen on that area (the caption reads
  *Watching*).
- **Seconds per stop** (10 to 600) and whether **new critical events
  interrupt** the tour.
- **Map layers**, grouped as on the Map: country tension, events,
  military aircraft, space stations, conflict zone bulletins, GPS
  interference and nuclear plants are on by default; ships, weather
  (alerts, alert zones, storm outlooks, clouds, precipitation), travel
  advisories, Wikipedia current events, power plants, submarine cables,
  military bases, SIGMETs and TFRs are off until you turn them on.
- **Sections:** show or hide the header, clocks, tension panel, figures,
  top events, live news, the weather at home (off by default), the
  caption and the ticker. With every side panel hidden the map fills the
  screen.
- **Layout:** the map wall, or **Live TV only**: one channel filling
  the screen, or two to four in a grid (**TV channels**). The LIVE pill
  stays in the corner.
- **Sound** for the live TV: on or muted, and the volume (in a grid only
  the first channel plays sound). Browsers block sound until someone
  touches the page, so a screen meant to play sound by itself needs
  kiosk mode, for example Chrome started with
  `--autoplay-policy=no-user-gesture-required`.
- The news **channel** and up to four extra **clocks**.

Press **Save**; the screen picks it up within about 10 seconds.

The wall's header has a **LIVE** pill: it turns **OFFLINE** if the
screen hasn't heard from Argus for over two and a half minutes.

### Wall profiles

Admins can save whole wall setups as named **profiles** (Settings >
Displays > **Wall profiles**), say an *Ops floor* with the tension tour
and a *Weather desk* with alerts and radar over home. Each paired
screen's **Shows** setting picks a profile or its own settings; screens
on a profile keep their own home. Editing a profile updates every screen
on it within a minute. **Save as profile** turns a screen's current
settings into a profile it then follows, and **Preview** opens a
profile at `/wall?profile=…` in any signed-in browser. Deleting a
profile sends its screens back to their own settings.
- A ticker of the latest events runs along the bottom, with clocks for UTC
  and home at the top.
- For long hours on screen: the layout drifts a pixel or two every few
  minutes (against burn-in), dims between 22:00 and 06:00 home time, hides
  the cursor when it's still, and keeps the screen awake where the browser
  allows.

## Map tools

The toolbar under the base map buttons, as in Palantir's Foundry Map:

| Tool | What it does |
|---|---|
| **Select ▾** | Box, polygon or circle: everything on the map inside the area (events, aircraft, ships) opens in a **Selection** panel with counts, the items themselves, **Zoom to area** and **Export CSV** |
| **Draw ▾** | Point, line, polygon, rectangle or circle. Areas show their size and circles their radius |
| **Measure** | Click points along a route; the running distance follows the cursor |
| **Note** | Click the map, type a note, press Enter |
| **Imagery** | Draw a box (up to about 100 km across) for recent satellite imagery of it: see [Recent imagery](#recent-imagery) |
| **Tours** | Director mode: saved camera moves with captions; see [Tours](#tours) |
| **Capture** | Saves a PNG of the map as it is now |
| **Delete** | **Click to delete** removes drawings and notes one at a time; **Delete all** clears them (after a confirmation) |

Lines and polygons: click to add points, double-click or **Enter** to
finish, **Backspace** to undo the last point, **Esc** to cancel. Drawings
are saved to your account.

### Tours

**Tours** in the toolbar opens director mode: tours are camera moves
with captions, for a briefing or a screen at the back of the room.

1. **New tour** starts one with the current view as its first shot.
2. Move the map to the next view (any angle: tilt with the **35°**
   button or by dragging) and press **+ Add the current view**. Repeat.
3. Give each shot a caption, how long to **fly** there (0 to 30 s) and
   how long to **hold** (1 to 600 s). **Set** replaces a shot with the
   current view; the arrows reorder.
4. **▶ Play** flies through the shots with each caption at the bottom
   of the map; **Loop** starts again at the end. Moving the map during a
   flight, or **■ Stop**, ends it. **▶** next to a shot plays from there.

Tours save to your account as you edit them. **Share link** copies a
link that opens the tour in the Tours panel and plays it for anyone
signed in to this Argus; they can **Save to my tours**.

### Recent imagery

**Imagery** in the toolbar, then click two corners of a box. Argus lists
the satellite passes over it from the last 60 days and lays the newest
clear one over the box:

- **Optical** (Sentinel-2): true colour at about 10 m, every 2 to 5 days.
  Needs daylight and clear skies; each pass shows its cloud cover.
- **Radar** (Sentinel-1): sees through cloud and at night, about every 6
  to 12 days. Bright means rough or metal (buildings, ships), dark means
  smooth (calm water, runways).

Click a pass to show it. **Compare** puts an older pass left of a split
line with the chosen one on the right; drag **Split** to wipe between
them (before and after a flood, a fire or a build-up). **Opacity** fades
the imagery over the map. The imagery shows from city zoom in and stays
on the map while you look at other things; **← Situation (remove
imagery)** takes it off.

The imagery comes from Microsoft's Planetary Computer (free, no key).
Your Argus server fetches the tiles and keeps them a week, so browsers
never contact Microsoft. Imagery is days old, not live, and commercial
high-resolution imagery isn't included.

## Legend

**Legend** beside the base map buttons shows what the colours and shapes
on the map mean, for the layers that are on.

## The layer panel

Type in **Filter layers** to find a layer by name or source. Click a group
title to fold it away (remembered in this browser); its count shows how
many of its layers are on. The dot beside a layer's count is its source's
health: green when it's collecting, yellow when its last fetch failed or
is overdue (hover for the error), grey when it isn't collecting.

## Cameras

| Layer | Shows | Source |
|---|---|---|
| **Traffic cameras** | Government road and weather cameras, with a wedge for the way each looks where the agency says. Click one and its live video starts (muted) where the agency streams it (most Caltrans and TDOT cameras), or its latest clip (London's JamCams); video plays straight from the agency's server. Otherwise you get its latest still, refreshed every 30 seconds, fetched by Argus's server; **Back to the still** switches over. Loads for a regional view (zoom in to about a state). Off by default | Caltrans (California), DriveBC (British Columbia), TfL JamCams (London, Powered by TfL Open Data), Fintraffic Digitraffic weather cameras (Finland, CC BY 4.0), no keys needed; TDOT SmartWay (Tennessee) with a TDOT key in Settings › Data sources |
| **Traffic camera viewsheds** | Where an agency gives a camera's direction (Caltrans, DriveBC), its estimated view is shaded on the ground: a 60° wedge about 300 m deep, brighter for the selected camera. Agencies don't publish zoom or tilt, so it's indicative | with Traffic cameras |
| **Webcams** | Public webcams (towns, beaches, ski slopes, harbours, city skylines) from windy.com, for a regional view. Click one and its daylight timelapse plays in the panel; the still preview, linked to its Windy page, is a click back. Windy's API doesn't share live streams, so **Live on Windy ↗** opens the stream on windy.com where the webcam has one. Off by default | windy.com, with a Windy key in Settings › Data sources |

## Live video near the view and about events

With a YouTube Data API key (Settings › Data sources):

- **Live near the view** in the Situation panel (when zoomed in to a
  region): **Find live streams here** lists YouTube live streams tagged
  with a place inside the view, most watched first. Click one to play it
  in the panel.
- **Video** in an event's panel: **Find video about this event** lists
  recent videos (since a few hours before the event began) for its place
  and kind of event, near it where uploads say where they were filmed.

Searches only run when you press the button; the key's free quota
allows about a hundred a day, and answers are shared between everyone for
half an hour (an hour for events). Video plays through
youtube-nocookie.com.

## Reference layers

The **Reference** group in the layer panel draws over any base map:

| Layer | Shows | Default |
|---|---|---|
| **Country borders** | Natural Earth 50m borders, light over imagery | on |
| **State / province borders** | First-level divisions (states, provinces, oblasts), below about 6,000 km | off |
| **Place labels** | Argus's own names: countries on wide views, cities of 200,000+ as you zoom in, larger cities first | on |
| **Basemap labels** | The map tiles' own names and roads, which fade in below about 450 km and take over from Argus's labels there. Turn off for Argus's labels only, at every height | on |
| **Airports** | Large airports with their IATA code, below about 1,200 km. Hover for its name; click for its details and recent headlines from your news feeds that name it. US airports also show the FAA's live status: a red ring for a ground stop or closure, amber for a ground delay program or delays, with the details in the panel | off |
| **Ports** | UN/LOCODE ports: sea ports (near the coast) below about 1,500 km, named when close; river and inland ports only close in. Hover or click one as for airports | off |
| **Travel advisories** | Countries the US State Department or the UK FCDO warn about, outlined and lightly shaded in the worse of the two: yellow for increased caution (US level 2), orange for reconsider travel or "avoid travel to parts" (US 3), red for do not travel (US 4). Hover for both governments' advice; click for the summary and links to the full advice. Refreshed every six hours | off |

## World tension

**World tension** at the top of the Situation panel scores organised
violence on a 0–100 scale, with the bands
[World Tension Meter](https://worldtensionmeter.com/) uses: calm (0–39),
stable (40–54), moderate (55–67), high tension (68–77) and extreme
(78–100). World Tension Meter also weighs markets and media attention,
so its number can differ; Argus counts violence only. It's built to line up with conflict indexes that use the
same kind of data (ACLED, UCDP, the Global Peace Index):

- **Standing level:** deaths from organised violence (wars, fighting
  between armed groups, attacks on civilians) in each country over the
  last twelve months of [UCDP](https://ucdp.uu.se/) data (Uppsala
  Conflict Data Program, CC BY 4.0), on a log scale: about 21 for 10
  deaths a year, 64 for 1,000, 100 for 50,000 or more. Bundled with Argus
  and refreshed with each release.
- **Live activity:** confirmed armed conflict, civil unrest and
  maritime-security events from Argus's own feeds (severity ×
  confidence, halving every 12 hours) add up to 20 points, so the score
  moves with the news. Unconfirmed GDELT reports don't count; most are
  noise.

The world score is the average of the 40 most affected countries; a
theatre's leans on its worst country. Hover a country in **Tension by
country** for its UCDP deaths and, once Argus has three days of history,
how its live activity compares with its normal.

Under the gauge are four tiles (events in the time window, military
aircraft, vessels in view, GPS interference cells) with a sparkline of
recent values, then **Last 60 minutes**, a few plain sentences on what came
in over the past hour. **Country tension** (in Events) tints countries from
moderate up on wide views, deeper the higher the score.

## In view

When you zoom in to a region, **In view** in the Situation panel lists the
events in the area on screen, most severe first, and updates as you move.

## Near home

The Situation panel lists events within your alert radius and, under
**Aircraft near home**, the aircraft inside it: military first, then
emergencies, then the nearest. Click one to select and follow it. Civil
traffic counts only when the map is showing your region.

## Search

The search box in the top bar takes anything. Argus works out what
you typed and offers matches:

| Type | For example | What happens |
|---|---|---|
| Flight number | `AA100`, `DL 1208`, `UAL696` | Finds the flight if it's airborne, selects it and follows it |
| Aircraft | `A55EF3` (ICAO hex), `N445UA`, `G-ABCD` | Same as a flight |
| Squawk | `7700`, `7600`, `7500` | Aircraft squawking that code, and a filter for emergencies |
| Airport | `BNA`, `KBNA` | Flies to the airport |
| Place | `Springfield, IL`, `Kyiv` | Flies to the place (towns of 15,000+) |
| Coordinates | `36.32, -86.71` | Flies to the point |
| Address | `1600 Pennsylvania Ave NW, Washington DC`, `10 Downing Street, London` | Pick **Find address** at the bottom of the list (or press Enter when nothing else matched): Argus looks it up in OpenStreetMap, lists the matches, and flies to the one you pick with a pin on it |
| Event | `Ishinomaki`, `earthquake Japan` | Opens matching events |
| Layer words | `earthquakes`, `protests`, `military`, `tankers`, `emergencies` | Applies that filter; **Reset filters** undoes it |

Use the arrow keys and **Enter** to pick a result, or **Esc** to clear the
box.

## Aircraft

- **Military aircraft** are shown worldwide, updated every 15 seconds, with
  their callsigns once you zoom in. Each has a role from its type: tanker,
  ISR, airlift, bomber and so on.
- **Civil aircraft** load for the area in view once you zoom in to a region
  (up to about 460 km across). At world view the panel says *Zoom in to a
  region to load*.
- **Show** in the layer panel narrows the map to emergencies or one military
  role.

Click an aircraft for its route (origin, destination and progress), altitude,
speed, track, squawk and type. A trail shows where it has been. Aircraft
squawking an emergency are red. If the route on file doesn't match where the
aircraft actually is (airlines reuse flight numbers), Argus says so instead of
showing progress.

### Camera views

Pick a view in the aircraft panel, or press **V** to cycle through them:

| View | What it does |
|---|---|
| **Free** | You move the map; the aircraft just stays selected |
| **Follow** | Top-down, centred on the aircraft. Zoom and tilt still work |
| **Chase** | Behind and a little above, turning with the aircraft. Scroll to move closer or further |
| **Orbit** | Circles the aircraft slowly. Zoom still works |
| **Cockpit** | From the aircraft, looking along its track, with a head-up display. Try it on **Satellite** |

For a flight with a known route, **Show route on map** in the aircraft
panel draws it: solid for the part already flown, dashed for the rest,
with the airport codes at each end.

Up close, the aircraft or ship is drawn as a 3D model of its kind:
airliner, widebody, business jet, light aircraft, helicopter, fighter or
military transport; container ship, tanker, passenger ship, fishing boat,
warship or small boat. Argus picks one from the aircraft type and emitter
category, or the ship's AIS category and length.

The cockpit **head-up display** shows the heading tape (with a magenta bug
pointing at the destination), ground speed and altitude tapes, vertical
speed, and the distance, bearing and time to the destination. ADS-B carries
no pitch or roll; Argus works out the turn rate from the last two reports,
keeps the aircraft turning along that arc between reports and banks the
view gently into the turn, and the HUD's horizon tilts with it.

Up close (inside about 12 km for aircraft, 8 km for ships), the flat
glyph turns into a simple 3D model, turned to its heading, so Chase and
Orbit look like what they are.

Positions arrive every 10 to 15 seconds; in between, Argus moves the aircraft
along its speed, track and climb rate so the camera glides. A bar at the
bottom of the map shows the view, callsign, altitude and speed. **Esc**
returns to Free, as do **⌂**, **◎** and **Fly to**.

Positions come from two free community ADS-B networks with the same API:
adsb.lol (ODbL; 500 requests a day per address) and adsb.fi (open data for
personal, non-commercial use; one request a second). Map views and lookups
ask adsb.lol first; the military feed asks adsb.fi first, to keep adsb.lol's
daily allowance for your map. When a network says to slow down, Argus
leaves it alone until it says it'll take requests again (for adsb.lol's
daily limit, the next day) and uses the other. Answers are shared between
everyone looking at the same area. If both are limiting, the panel says
*ADS-B feeds are busy* and shows the most recent positions.

The aircraft panel says which network each position came from. Routes and
types come from adsbdb and are the *planned* route. Aircraft whose owners
opted out of tracking (the FAA's PIA and LADD programmes) are not shown
unless they are military, and Argus never shows registered owner names.

## Airspace

The **Airspace** group draws areas in force, translucent with an outline.
Click one for its details and the source text.

| Layer | Shows | Source |
|---|---|---|
| **Flight restrictions (TFRs)** | US temporary flight restrictions: VIP movements, security, space launches, hazards | FAA (tfr.faa.gov) |
| **SIGMETs** | Thunderstorms, turbulence, icing, volcanic ash, tropical cyclones, coloured by hazard, with base and top | aviationweather.gov |
| **Conflict zone bulletins** | EASA's warnings to airlines about conflict airspace, drawn as closed airspace: the countries they cover hatched in red with a dashed edge | EASA |
| **GPS interference** | Hexagons about 55 km across where over 2% of aircraft report a degraded position over the last hour, deeper pink the higher the share (over 10% is high) | Argus, from ADS-B |
| **Restricted areas, CTRs, TMAs** | Restricted, prohibited and danger areas, control zones, terminal and control areas, military training areas, with lower and upper limits. Loads for a regional view; needs an openAIP key | openAIP |

GPS interference uses the method gpsjam.org uses, but only from the
aircraft Argus sees: military aircraft worldwide, civil traffic where
someone is looking, your own receiver, and a sweep of the places where
interference is usually reported (the Baltic, Finnmark, the Black Sea,
the Caucasus, the eastern Mediterranean, Iraq and Syria, the Persian
Gulf). The sweep asks adsb.fi for one of those areas after each military
poll, so each is refreshed about every five minutes. Cells need at
least eight aircraft in the last hour, so a quiet area can stay clear.
Not for navigation.

If the openAIP row says *openAIP is refusing this server (403)*, openAIP's
Cloudflare front end is turning this server's address away before it
looks at the key. Argus doesn't try to get round that; contact openAIP
through [openaip.net](https://www.openaip.net/) to have your server
allowed.

## Weather

| Layer | Shows | Source |
|---|---|---|
| **Storm warnings** | NWS warnings that come with their own area (tornado, severe thunderstorm, flash flood, special marine and similar), in the NWS's colours. Hover or click for the text | NWS (US) |
| **Watches and advisories** | NWS watches, warnings and advisories issued for whole forecast zones or counties (winter storms, heat, wind, flood watches, red flag warnings), drawn on those zones' outlines. Zone shapes are fetched from the NWS as alerts need them, so a fresh install fills in over the first few minutes | NWS (US) |
| **Severe weather outlook** | Today's Storm Prediction Center risk areas on its 1–5 scale (Marginal, Slight, Enhanced, Moderate, High), in SPC's colours | SPC (US) |
| **Clouds (infrared)** | The latest geostationary infrared scan (cloud tops, colder = higher), about 40 minutes behind, refreshed every 10 minutes. Covers the Americas, the Pacific and East Asia; GIBS has no Meteosat for Europe and Africa | NASA GIBS (GOES-East, GOES-West, Himawari) |
| **Precipitation** | Rain and snow rate from satellites, half-hourly, a few hours behind | NASA GIBS (IMERG) |

With a home location in the US, **Weather at home** in the Situation panel
shows the temperature, today's high and low, wind and gusts and the chance
of rain (Open-Meteo), plus every NWS warning, watch and advisory for your
home's forecast zone and county, linked to the full alert.

## Infrastructure

| Layer | Shows |
|---|---|
| **Nuclear plants** | Every nuclear power plant as a tan diamond, named when you're close |
| **Power plants (300 MW+)** | Coal, gas, oil, hydro and large renewables, coloured by fuel and sized by capacity |
| **Submarine cables** | Undersea internet cables in their map colours, with landing points |
| **Military bases** | Named bases, naval bases and military airfields (from about 3,000 km in, named close up), plus ranges, training areas and barracks closer in |
| **Plate reader cameras** | Automatic licence plate readers (Flock Safety, Motorola/Vigilant, Genetec and others) as volunteers have mapped them in OpenStreetMap, the dataset [DeFlock](https://deflock.me) maintains. A wedge shows which way a camera faces where that is mapped. Hover for the vendor, operator and when it was mapped. Click one for everything that's mapped about it (operator and its type, vendor and model, the directions it faces, mount, zone, install and survey dates, every OpenStreetMap tag), links to OpenStreetMap and the DeFlock map, a search for the agency's Flock transparency portal (camera counts, retention and sharing, where the agency publishes one), and the operators and vendors of the cameras in view. Loads for a regional view (zoom in to about a state); a new area can take a minute the first time (the layer row says loading), then it's kept for a week. The area around each saved home is fetched ahead in the background, so it shows at once. Locations only: there is no public plate data and Argus never looks for any. Off by default |

Power plants come from the WRI Global Power Plant Database, last updated in
2021, so newer plants are missing. Cables come from TeleGeography's
submarine cable map; click one for a link to its owners and length.
Military sites come from OpenStreetMap, as volunteers have mapped them:
coverage varies by country.

## Live news

**▶ News** beside the base map buttons opens a floating live player. It starts muted;
unmute it in the player. Drag it by its title bar and resize it from the
corner. Tabs switch channel; **⋯** chooses which channels have tabs;
**+** adds another player (up to four, each with its own channel and
place); **⧉** opens the channel in its own window, for another screen.

- **US:** LiveNOW from FOX, Newsmax, NBC News NOW, CBS News 24/7, ABC
  News Live, Alex Jones Live
- **International:** GB News, Euronews, CNA, BBC News, Al Jazeera
  English, DW, France 24, TRT World, WION, NHK World
- **Business:** Bloomberg
- **Weather:** Ryan Hall, Y'all (live during major weather events), FOX
  Weather

Only channels with a true live stream are listed: 24/7 streams, or a
TV channel simulcast live, plus Ryan Hall's storm coverage, which goes
live for major weather events. Channels that stream only special events
(Fox News, Fox Business, Reuters, Sky News) or are rarely live were
left out.

Each tab plays the channel's current live stream: Argus looks up the
live video from the channel's page (checked every few minutes, once for
everyone) and plays it through YouTube's embed, or Rumble's for Alex
Jones Live, which isn't on YouTube. If a channel isn't live, the player
says so.

## Ships

The **Sea** group shows vessels from AIS, the position reports ships
broadcast, by category: military and law enforcement, tankers, cargo,
passenger, fishing and other. It needs an AISStream key, which an
administrator adds in **Settings → Data sources**; until then the group
says so.

Vessels load for the area in view, most interesting first (military,
tankers, passenger, cargo), up to 4,000 at a time. Moving ships are hulls
turned to their heading; stopped or moored ones are dots. Names appear as
you zoom in.

Click a vessel for its name, flag, type and status, speed, course,
destination and ETA (as the crew entered them), draught, size, IMO number
and callsign. The camera views work for ships too: **Follow**, **Chase**,
**Orbit** and **Bridge**. The bridge view has its own display: a compass
tape with the course over ground marked, speed and course boxes, the
ship's gyro heading and drift (where AIS sends a heading), and the
status, destination, ETA, draught and size along the bottom. Search by name, MMSI (`366123456`) or IMO
(`IMO 9811000`).

AIS is self-reported: ships can enter wrong details, and some switch AIS
off.

## Ship sanctions

Ships on a sanctions list get a **red ring** on the map, and their panel
has a **Sanctions and risk** section listing each entry, with a link to
it on OpenSanctions:

- **Sanctioned:** on a government list (US OFAC, EU, UK, UN, Canada,
  Switzerland and others).
- **Shadow fleet:** named as part of the fleet moving sanctioned oil.
- **War-related list:** on Ukraine's list of vessels involved in the war.
- **Detained in port inspection** and **regulator warning** appear in the
  panel only: they're about the ship's condition, not sanctions.

Ships are matched by IMO number first, then MMSI, never by name (names
repeat). An MMSI can move to another ship when it changes flag, so check
the listing before relying on it. The list is OpenSanctions' maritime
dataset (CC BY-NC 4.0, free for non-commercial use), which Argus's
server fetches daily. **Settings › Alerts › Sanctioned ships** tells you
when one comes into view.

## Disasters and maritime warnings

Two more event layers:

- **Disasters**: floods, tropical cyclones, volcanoes, droughts and
  wildfires from GDACS (with its green, orange or red alert level), named
  storms and other natural events from NASA EONET, and bulletins from the
  US tsunami warning centres (a tsunami warning is catastrophic). Select a
  storm to see its track.
- **Maritime warnings** (off by default): NGA's navigational warnings,
  such as rocket launches, live firing, exercises, cable work, piracy and
  hazards to shipping. Select one to see the area it covers.

## Alerts

**Settings › Alerts** (analysts and admins) sets up your own alerts.
Argus checks your rules every minute against what it already watches,
and each alert fires once.

**Rules** (add as many as you like):

| Rule | Fires when |
|---|---|
| **Events in an area** | A new event at or above a severity, of the kinds you tick, starts inside your home radius, a shape you drew on the map, or anywhere |
| **Air-raid alerts** | An alert starts in the Ukrainian oblasts you pick (or any), or anywhere in Israel. Continuous alerts in occupied areas never fire |
| **FAA airport status** | A ground stop or closure (and optionally delays) at the US airports you list; once a day each |
| **Patterns** | A military aircraft flies an orbit or racetrack, or a ship loiters on a cable, in your area |
| **Watchlist** | A military aircraft (hex, callsign or registration) or a ship (MMSI) you list comes into view; once a day each |
| **Sanctioned ships** | A ship on a sanctions, shadow-fleet or war-related list comes into view (anywhere, or in your area); once a day each |
| **Geomagnetic storm** | NOAA's G scale reaches the level you set |

A new rule (or one switched back on) only fires for things that start
after it, so it never floods you with the backlog. Each rule sends at
most 10 alerts an hour.

**Delivery:**

- **The bell** at the top of Argus always shows your alerts; click one to
  open it on the map. It can also show them as browser notifications
  while Argus is open.
- **ntfy:** push to your phone or desktop with the free ntfy app. Press
  **Make one** for a private topic, subscribe to it in the app, save,
  then **Send a test**. Anyone who knows the topic can read it, so keep
  it private (Argus stores it encrypted). Use your own ntfy server by
  changing **Server**.
- **Webhook:** each alert is POSTed to a URL, as JSON, or formatted for
  Discord or Slack (Home Assistant, n8n and the like take the JSON). The
  URL is stored encrypted. Argus won't post to itself or to loopback and
  cloud-metadata addresses; addresses on your network are fine.
- **Quiet hours:** no pushes between two times in your time zone; alerts
  still collect under the bell.

## Air-raid alerts

**Air-raid alerts** (Airspace group, on by default) shows alerts as the
authorities issue them, refreshed every 30 seconds:

- **Ukraine**, by oblast, from the official air-raid map (via
  ubilling.net.ua): a red ring at each oblast under alert, labelled when
  you zoom in. Hover for how long it's been on. Occupied areas under a
  continuous alert since 2022 (Luhansk, Sevastopol) are dimmed.
- **Israel**, by locality, from the Home Front Command (via Tzeva Adom):
  bright while sounding, dimmer for the rest of the last 24 hours, with
  the threat (rockets and missiles, hostile aircraft, terrorist
  infiltration and so on). Drills are left out.

The Situation panel's **Air-raid alerts** section lists the oblasts
under alert (click one to fly there) and Israel's latest. For your own
safety, use the official apps: Argus can be up to a minute behind.

## Patterns

When military aircraft or ships are on, the Situation panel lists
behaviour worth a look, with a ring on the map; click an entry to select
the aircraft or ship:

- **Orbit** or **Racetrack:** a military aircraft that has turned 1.5
  times or more within about 40 km over the last 45 minutes, above
  3,000 ft. Tankers, AWACS and surveillance aircraft fly these.
- **Loitering on a cable:** a ship that has stayed within 3 km for two
  hours or more, slowly, within 10 km of a submarine cable and away from
  towns (harbours and anchorages). Several Baltic cable cuts involved
  ships behaving this way.

They're indicators, not conclusions: aircraft also train in circuits and
ships wait out weather. Argus works them out from the tracks it already
holds (about the last hour for aircraft, eight hours for ships), so a
pattern needs that long in view. AIS "gaps" (ships going dark) aren't
flagged: with shore-based AIS most gaps are just ships out of range.

## Cyber

Two layers at the end of the **Infrastructure** group, off by default,
and a Brief section:

- **Internet outages:** countries where Georgia Tech's IODA saw an
  internet outage in the last 24 hours, tinted purple (stronger while
  it's ongoing). Hover for when it started, what saw it (BGP routing,
  active probing, Google traffic) and its size; click for a link to the
  IODA dashboard. An outage can be a government shutdown, a power cut,
  a cable cut or a fault.
- **Ransomware victims:** a marker per country, sized and labelled with
  how many organisations ransomware groups claimed there among the
  latest 100 claims worldwide (usually a day or two, from
  ransomware.live). Hover for the main sectors and groups. These are
  criminals' claims, not confirmed breaches, so Argus keeps counts, not
  victim names.
- **Exploited vulnerabilities** (Brief): the newest entries in CISA's
  Known Exploited Vulnerabilities catalogue, with a ransomware flag
  when CISA knows of ransomware use and the date US federal agencies
  must fix them. Each links to its NVD entry.

The worker refreshes outages and ransomware every half hour, and CISA's
list every six hours.

## Rocket launches

**Rocket launches** (Space group, on by default) puts a rocket at each
launch pad with a launch in the last three days or the next two weeks,
worldwide:

- **Gold, ringed:** launching within 48 hours.
- **Violet:** later in the next two weeks.
- **Green:** launched successfully; **red:** failed.

The label names the rocket (+N when the pad has more launches coming).
Hover for the mission, the countdown (T−) and the pad; click for the
mission description, the launch window, the weather forecast where
there is one, every launch at that pad and the pad's Wikipedia page.
Times marked as a month or a day are not yet fixed.

The data comes from The Space Devs' Launch Library 2 (free, no key), read
by Argus's server every two hours.

## Space weather

The Situation panel and the Brief have a **Space weather** section from
NOAA's Space Weather Prediction Center, refreshed every ten minutes:

- The three NOAA scales now, 0 (none) to 5 (extreme): **R** radio
  blackouts (HF radio and GPS on the day side), **S** solar radiation
  storms (polar flights, satellites) and **G** geomagnetic storms (power
  grids, satellites, GPS, HF radio; auroras). Hover a scale for what it
  affects.
- The planetary **Kp** index now and its 24-hour high, with bars for the
  last eight 3-hour readings. Kp 5 is a G1 storm, 9 a G5.
- The outlook for the next three days: the chance of R1 or worse radio
  blackouts, and any geomagnetic storm level forecast.
- The latest alerts, warnings and watches (three in the panel, six in
  the Brief); hover one for NOAA's full message.

## Satellites

The **Space** group shows every active satellite CelesTrak tracks, about
17,000, by orbit:

| Layer | What's there |
|---|---|
| **Space stations** | The crewed stations: the ISS as a 3D model (truss, modules and solar arrays) that moves smoothly and faces its direction of travel, and Tiangong. Visible from far out; true size up close |
| **Low Earth orbit** | Under about 2,000 km: space stations, imaging, weather and science |
| **Medium Earth orbit** | Navigation constellations: GPS, Galileo, GLONASS, BeiDou |
| **Geosynchronous** | Communications and weather satellites over fixed longitudes |
| **Highly elliptical** | Molniya, Tundra and other long, looping orbits |
| **Starlink** | About 11,000 satellites, off by default |

Your browser works out every position each second with SGP4 from
CelesTrak's elements, so nothing is downloaded per second. Click a
satellite (or search its name, NORAD number like `25544`, or COSPAR ID
like `1998-067A`) to see:

- its orbit as a ring and its ground track (dashed) for the next orbit and
  a half;
- altitude and speed now, period, inclination, perigee and apogee;
- its **passes over home** in the next 24 hours: rise and set times (UTC),
  the highest elevation, and how soon. Passes count above 10°.

**Follow** keeps it in view as it moves; scroll to zoom. The ISS moves at
7.7 km/s, so following is the easiest way to watch it.

## Events

Markers are coloured by severity (info, elevated, high, critical,
catastrophic). High and above pulse. Faded markers are unconfirmed reports,
hidden unless **Unconfirmed reports** is on. Click a marker or a feed item
to open its sources, matching headlines and raw record. **Coverage**
lists headlines from your news feeds that name the event's place (its
town or city, not just the country) and say what happened (for an
earthquake, words like "quake" or "tremor"); GDELT events use the same
test that confirms them.

**Source records** on a GDELT event are the articles GDELT itself coded it
from. GDELT matches articles to events automatically, so some are about
something else. Each is tagged: **names** the place when its link mentions
the place, **doesn't name the place** when the link has a headline that
doesn't (shown dimmed, at the bottom), **headline not in link** when the
link is only a number, and **coded as …** when GDELT coded that article as
a different kind of event.

**Wikipedia events** (in Events, off by default) puts the last
three days of Wikipedia's Current events portal on the map: each entry at
the most specific place it links to (a city or a bridge before a
country), a ring for armed conflicts and attacks and a dot for anything
else. Hover for the entry; click for its story thread, the Wikipedia page
and its news sources. Entries are edited by Wikipedia's volunteers and
refreshed hourly; they aren't events, so they don't count towards
tension.

The small **Data attribution** link at the bottom left lists the imagery
providers, who require credit on the map.
