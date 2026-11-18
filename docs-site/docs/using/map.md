---
title: The map
---

# The map

## Base maps

Choose the base map with the **Dark / Satellite / Hybrid** buttons at the top
left of the map. Your choice is remembered.

| Base map | What you see | Source |
|---|---|---|
| **Dark** (default) | Graphite countries, borders and a faint graticule on a near-black ocean. Below about 3,000 km a dark street map with labels fades in, down to street level. | Natural Earth shapes bundled with Argus; Esri Dark Gray Canvas tiles when zoomed in |
| **Satellite** | Aerial and satellite imagery down to about 0.3 m per pixel in many cities, like Google Maps. | Esri World Imagery over NASA Blue Marble |
| **Hybrid** | Satellite with roads, borders and place names on top. | Esri World Imagery and reference layers |

The Esri services are hosted and need no key for light personal use. A
self-hosted street map and an imagery-provider key in Settings are planned
for milestone 2.

## Moving around

- **Drag** to pan, **scroll** or pinch to zoom, **right-drag** or Ctrl-drag
  to tilt.
- **⌂** flies home. **◎** shows the whole world centred on your longitude.
- **3D Globe / 2D World** switches between the globe and a flat map.
- **[** and **]** collapse the layer panel and the situation panel.
- **Esc** closes an event or aircraft and returns to the situation panel.
- **/** jumps to the search box.

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
speed, track, squawk and type. **Follow** keeps it centred as it moves, and a
trail shows where it has been. Aircraft squawking an emergency are red.

Positions come from adsb.lol, a community ADS-B network (ODbL). Routes and
types come from adsbdb and are the *planned* route. Aircraft whose owners
opted out of tracking (the FAA's PIA and LADD programmes) are not shown
unless they are military, and Argus never shows registered owner names.

## Events

Markers are coloured by severity (info, elevated, high, critical,
catastrophic). High and above pulse. Faded markers are unconfirmed reports,
hidden unless **Unconfirmed reports** is on. Click a marker or a feed item
to open its sources, matching headlines and raw record.

The small **Data attribution** link at the bottom left lists the imagery
providers, who require credit on the map.
