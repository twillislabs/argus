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
| **Place labels** | Country names on wide views; cities of 200,000+ as you zoom in, larger cities first | on |
| **Airports** | Large airports with their IATA code, below about 1,200 km | off |

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

The cockpit **head-up display** shows the heading tape (with a magenta bug
pointing at the destination), ground speed and altitude tapes, vertical
speed, and the distance, bearing and time to the destination. ADS-B carries
no pitch or roll, so the horizon line stays level where the camera sees the
real horizon.

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
to open its sources, matching headlines and raw record.

The small **Data attribution** link at the bottom left lists the imagery
providers, who require credit on the map.
