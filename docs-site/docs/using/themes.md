---
title: Themes
---

# Themes

A theme changes how all of Argus looks: colours, fonts, corner shapes,
glow, a screen overlay and the header bar. The dark map's land, sea,
borders and coastlines follow it too, and so do the sign-in, setup and
pairing pages. Map markers keep their own colours, so an earthquake or a
military aircraft looks the same in every theme.

## Choosing a theme

**Settings › Display › Theme** lists every theme. Click one and the
page changes at once. **Server default** follows whatever an
administrator picked for everyone, including when they change it later.

Administrators set that default in **Settings › Defaults › Theme**. It
is also what the sign-in and pairing pages show, since nobody is signed
in there yet.

## The built-in themes

| Theme | Look |
|---|---|
| **Argus Dark** | The default: near-black panels and a cool blue accent. |
| **Cassette Futurism** | A 1970s–80s console: amber phosphor text with a glow, scanlines and a vignette, a dark tan header with a red, orange and yellow stripe, and a pixel font. |
| **Cyberpunk** | Neon magenta and cyan on deep purple-black, panels with cut corners, warning-yellow highlights and wide techno headings. |
| **Hologram** | Rounded, frosted glass panels lit from inside, soft cyan glow and a faint light sweep across the screen. |
| **Vector** | An old vector display: glowing teal lines on pure black, square corners, monospaced type and a fine grid. |
| **Night Ops** | Everything in shades of red on black, so eyes adjusted to the dark stay adjusted. Severity is shown by brightness. |
| **Daylight** | Light grey and white panels with dark text, and a light street map. Good for bright rooms and screenshots. |

## Making your own

Administrators make themes in **Settings › Themes**:

1. Pick a built-in theme under **New theme from**. Your theme starts as
   a copy of it.
2. Give it a **Name** (the **Id** is made from the name; it can't be a
   built-in theme's id).
3. Change what you want: fonts, corners, corner radius, glow, screen
   overlay, header stripe, and any colour. The page shows your theme as
   you go (**Preview** redraws it). A colour you change is marked; **↺**
   puts it back to the base theme's.
4. **Save theme**. Everyone can now pick it in Settings › Display, and
   Settings › Defaults can make it everyone's.

**Show JSON** and **JSON** give a theme as text to copy, back up or
share; **Paste JSON…** loads one into the editor. Leaving the page puts
your own theme back.

### The theme format

A theme is a JSON object. Only `id` and `name` are required: anything
left out comes from the `base` theme (Argus Dark when there's no base).

```json
{
  "id": "harbour",
  "name": "Harbour",
  "blurb": "Teal on deep navy, with scanlines.",
  "base": "cyber",
  "colors": {
    "bg": "#07131c",
    "surface": "#0b1c29",
    "accent": "#3fd0c9",
    "hdrBg": "rgba(11, 28, 41, 0.9)"
  },
  "map": { "ocean": "#04101a", "land": "#102434", "coast": "rgba(63, 208, 201, 0.6)" },
  "fonts": { "head": "orbitron", "body": "inter", "mono": "sharetech" },
  "corners": "cut",
  "radius": 4,
  "glow": 0.5,
  "overlay": "scanlines",
  "stripe": "neon"
}
```

| Key | Values |
|---|---|
| `id` | Lower-case letters, digits and dashes, up to 40 characters; not a built-in id. |
| `name` | Up to 40 characters. |
| `blurb` | Optional description shown in the theme list, up to 120 characters. |
| `base` | A built-in theme to start from: `dark`, `cassette`, `cyber`, `holo`, `vector`, `nightops` or `day`. |
| `colors` | Any of the colours below. |
| `map` | Any of the dark map's colours below. |
| `fonts` | `head` (headings), `body` (text) and `mono` (numbers, codes): `barlow`, `inter`, `jetbrains`, `vt323`, `plexmono`, `orbitron`, `rajdhani`, `sharetech` or `exo2`. |
| `corners` | `round` (uses `radius`), `square` or `cut` (angled corners on panels and buttons). |
| `radius` | Corner radius in pixels, 0 to 24, for round corners. |
| `glow` | 0 (none) to 1: a glow in the accent colour on headings, titles and numbers. |
| `overlay` | Over the whole screen: `none`, `scanlines`, `crt` (scanlines and a vignette), `sheen` (a faint light sweep) or `grid`. |
| `stripe` | Under the header: `none`, `cassette` (red, orange, yellow), `neon` (magenta to the accent) or `line` (a thin accent line). |

Colours are `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)` or
`rgba(r, g, b, a)`. Nothing else is accepted (no names, gradients or
`url()`), so a theme can't change anything but these values.

**`colors`:**

| Key | Used for |
|---|---|
| `bg` | Page background |
| `surface` | Panels and cards |
| `surface2` | Raised parts of panels (hover, tiles) |
| `surface3` | Selected and pressed parts |
| `line` | Thin dividers |
| `line2` | Borders of controls |
| `text` | Main text |
| `muted` | Secondary text |
| `dim` | Least important text (sources, hints) |
| `accent` | Links, toggles, selection, glow |
| `accentText` | Text on accent-coloured buttons |
| `crit`, `high`, `elev`, `ok` | Severity: critical, high, elevated, and good or healthy |
| `hdrBg`, `hdrText`, `hdrMuted` | The header bar's background, text and secondary text |

**`map`** (the Dark base map and the sign-in globe):

| Key | Used for |
|---|---|
| `ocean` | Sea |
| `land` | Land |
| `border` | Country borders |
| `coast` | Coastlines |
| `graticule` | Latitude and longitude lines |
| `background` | Space behind the globe |

Keep text readable: aim for at least 4.5:1 contrast between `text` and
`surface` (and `muted` and `surface`), which a contrast checker will
tell you.

For adding a theme to Argus itself (a new built-in one), see
[Themes (technical)](../technical/themes.md).
