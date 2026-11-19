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
- **Double-click** an event to zoom in on its area, or an aircraft to follow
  it.
- **Esc** leaves an aircraft view, then closes the event or aircraft and
  returns to the situation panel.
- **/** jumps to the search box.

## Reference layers

The **Reference** group in the layer panel draws over any base map:

| Layer | Shows | Default |
|---|---|---|
| **Country borders** | Natural Earth 50m borders, light over imagery | on |
| **State / province borders** | First-level divisions (states, provinces, oblasts), below about 6,000 km | off |
| **Place labels** | Argus's own names: countries on wide views, cities of 200,000+ as you zoom in, larger cities first | on |
| **Basemap labels** | The map tiles' own names and roads, which fade in below about 450 km and take over from Argus's labels there. Turn off for Argus's labels only, at every height | on |
| **Airports** | Large airports with their IATA code, below about 1,200 km | off |
| **Ports** | UN/LOCODE ports: sea ports (near the coast) below about 1,500 km, named when close; river and inland ports only close in | off |

## World tension

**World tension** at the top of the Situation panel scores how tense the
world is now against its own recent past, 0 to 100: 50 is normal, 67 is
twice normal, 80 and up is severe. Below it are the five countries furthest
above their normal. **Country tension** (in Events) tints those countries
red on wide views, deeper the higher the score; it fades out as you zoom in.

The score counts armed conflict, civil unrest and maritime-security
events: severity × confidence, halving every 12 hours, with unconfirmed
reports at half weight. The worker samples it hourly, and the baseline is
the average of those samples over the last 90 days. A new install builds
its first baseline from the events already stored; until there's a week of
history the panel says it's still learning.

## In view

When you zoom in to a region, **In view** in the Situation panel lists the
events in the area on screen, most severe first, and updates as you move.

## Near home

The Situation panel lists events within your alert radius and, under
**Aircraft near home**, the aircraft inside it: military first, then
emergencies, then the nearest. Click one to select and follow it. Civil
traffic counts only when the map is showing your region.

## Search

The search box under the map controls takes anything. Argus works out what
you typed and offers matches:

| Type | For example | What happens |
|---|---|---|
| Flight number | `AA100`, `DL 1208`, `UAL696` | Finds the flight if it's airborne, selects it and follows it |
| Aircraft | `A55EF3` (ICAO hex), `N445UA`, `G-ABCD` | Same as a flight |
| Squawk | `7700`, `7600`, `7500` | Aircraft squawking that code, and a filter for emergencies |
| Airport | `BNA`, `KBNA` | Flies to the airport |
| Place | `Goodlettsville, TN`, `Kyiv` | Flies to the place (towns of 15,000+) |
| Coordinates | `36.32, -86.71` | Flies to the point |
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

Up close, the aircraft or ship is drawn as a 3D model of its kind:
airliner, widebody, business jet, light aircraft, helicopter, fighter or
military transport; container ship, tanker, passenger ship, fishing boat,
warship or small boat. Argus picks one from the aircraft type and emitter
category, or the ship's AIS category and length.

The cockpit **head-up display** shows the heading tape (with a magenta bug
pointing at the destination), ground speed and altitude tapes, vertical
speed, and the distance, bearing and time to the destination. ADS-B carries
no pitch or roll, so the horizon line stays level where the camera sees the
real horizon.

Up close (inside about 12 km for aircraft, 8 km for ships), the flat
glyph turns into a simple 3D model, turned to its heading, so Chase and
Orbit look like what they are.

Positions arrive every 10 to 15 seconds; in between, Argus moves the aircraft
along its speed, track and climb rate so the camera glides. A bar at the
bottom of the map shows the view, callsign, altitude and speed. **Esc**
returns to Free, as do **⌂**, **◎** and **Fly to**.

adsb.lol limits how often each address can ask. Argus spaces its requests,
shares answers between everyone looking at the same area, and pauses after a
limit. While paused, the panel says *adsb.lol is busy* and shows the most
recent positions.

Positions come from adsb.lol, a community ADS-B network (ODbL). Routes and
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
| **Conflict zone bulletins** | EASA's warnings to airlines about conflict airspace, shown by tinting the countries they cover | EASA |
| **GPS interference** | Hexagons about 55 km across where over 2% of aircraft report a degraded position over the last hour, deeper pink the higher the share (over 10% is high) | Argus, from ADS-B |
| **Restricted areas, CTRs, TMAs** | Restricted, prohibited and danger areas, control zones, terminal and control areas, military training areas, with lower and upper limits. Loads for a regional view; needs an openAIP key | openAIP |

GPS interference uses the method gpsjam.org uses, but only from the
aircraft Argus sees: military aircraft worldwide, civil traffic where
someone is looking, and your own receiver. Cells need at least eight
aircraft. Not for navigation.

## Infrastructure

| Layer | Shows |
|---|---|
| **Nuclear plants** | Every nuclear power plant, named when you're close |
| **Power plants (300 MW+)** | Coal, gas, oil, hydro and large renewables, coloured by fuel and sized by capacity |
| **Submarine cables** | Undersea internet cables in their map colours, with landing points |
| **Military bases** | Named bases, naval bases and military airfields (from about 3,000 km in, named close up), plus ranges, training areas and barracks closer in |

Power plants come from the WRI Global Power Plant Database, last updated in
2021, so newer plants are missing. Cables come from TeleGeography's
submarine cable map; click one for a link to its owners and length.
Military sites come from OpenStreetMap, as volunteers have mapped them:
coverage varies by country.

## Live news

**TV** in the map controls opens a floating live player. It starts muted;
unmute it in the player. Drag it by its title bar and resize it from the
corner. Tabs switch channel; **⋯** chooses which channels have tabs;
**+** adds another player (up to four, each with its own channel and
place); **⧉** opens the channel in its own window, for another screen.

- **US:** LiveNOW from FOX, Fox News, Newsmax, NBC News, CBS News, MS NOW,
  ABC News, NewsNation, Alex Jones Live
- **International:** Sky News, GB News, News24 (formerly Sky News
  Australia), Euronews, CNA, BBC News, Al Jazeera English, DW, France 24,
  i24NEWS, TRT World, WION, NHK World
- **Business:** Reuters, Bloomberg
- **Weather:** Ryan Hall, Y'all, FOX Weather

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
**Orbit** and **Bridge**. Search by name, MMSI (`366123456`) or IMO
(`IMO 9811000`).

AIS is self-reported: ships can enter wrong details, and some switch AIS
off.

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

## Satellites

The **Space** group shows every active satellite CelesTrak tracks, about
17,000, by orbit:

| Layer | What's there |
|---|---|
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

The small **Data attribution** link at the bottom left lists the imagery
providers, who require credit on the map.
