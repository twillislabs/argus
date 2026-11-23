"""Themes: the built-in ids, and checking custom themes an admin saves.

A theme is a set of named values (colours, fonts, corner style, glow, a
screen overlay and a header stripe) that the browser turns into CSS
variables and data attributes. The built-in themes live in the frontend
(lib/themes.ts); custom ones are stored in server_settings["themes"] as
{"items": [...]}. Every value is checked against a fixed list or a
strict pattern here, so a custom theme can't carry CSS of its own.

Format (all keys but id and name optional; a missing value comes from
the base theme):

    {"id": "harbour", "name": "Harbour", "base": "dark",
     "colors": {"bg": "#0b1016", "accent": "#3fd0c9", ...},
     "map": {"ocean": "#06101a", "land": "#14202c", ...},
     "fonts": {"head": "orbitron", "body": "inter", "mono": "sharetech"},
     "corners": "cut", "radius": 4, "glow": 0.5,
     "overlay": "scanlines", "stripe": "neon"}
"""

import re

BUILTIN = ("dark", "cassette", "cyber", "holo", "vector", "nightops", "day")
DEFAULT = "dark"
MAX_CUSTOM = 20

COLORS = (
    "bg",
    "surface",
    "surface2",
    "surface3",
    "line",
    "line2",
    "text",
    "muted",
    "dim",
    "accent",
    "accentText",
    "crit",
    "high",
    "elev",
    "ok",
    "hdrBg",
    "hdrText",
    "hdrMuted",
)
MAP_COLORS = ("ocean", "land", "border", "coast", "graticule", "background")
FONTS = (
    "barlow",
    "inter",
    "jetbrains",
    "vt323",
    "plexmono",
    "orbitron",
    "rajdhani",
    "sharetech",
    "exo2",
)
FONT_ROLES = ("head", "body", "mono")
CORNERS = ("round", "square", "cut")
OVERLAYS = ("none", "scanlines", "crt", "sheen", "grid")
STRIPES = ("none", "cassette", "neon", "line")

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
HEX = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB = re.compile(
    r"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*"
    r"(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$"
)


class ThemeError(ValueError):
    """Something wrong with a custom theme, said for people."""


def valid_color(value) -> bool:
    return isinstance(value, str) and bool(
        HEX.match(value) or RGB.match(value)
    )


def _colors(raw, keys, what: str) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ThemeError("{0} must be an object.".format(what))
    out = {}
    for k, v in raw.items():
        if k not in keys:
            raise ThemeError("{0} has no colour {1}.".format(what, k))
        if not valid_color(v):
            raise ThemeError(
                "{0}.{1} must be #rgb, #rrggbb or rgb()/rgba().".format(
                    what, k
                )
            )
        out[k] = v
    return out


def clean(raw: dict, others: set[str] | None = None) -> dict:
    """A custom theme, checked; raises ThemeError."""
    if not isinstance(raw, dict):
        raise ThemeError("A theme must be an object.")
    tid = str(raw.get("id") or "").strip().lower()
    if not ID_RE.match(tid):
        raise ThemeError(
            "A theme id is lower-case letters, digits and dashes."
        )
    if tid in BUILTIN:
        raise ThemeError("{0} is a built-in theme's id.".format(tid))
    if others and tid in others:
        raise ThemeError("Two themes are called {0}.".format(tid))
    name = " ".join(str(raw.get("name") or "").split())[:40]
    if not name:
        raise ThemeError("Give the theme a name.")
    base = raw.get("base") or DEFAULT
    if base not in BUILTIN:
        raise ThemeError("base must be one of the built-in themes.")
    out = {"id": tid, "name": name, "base": base}
    blurb = " ".join(str(raw.get("blurb") or "").split())[:120]
    if blurb:
        out["blurb"] = blurb
    colors = _colors(raw.get("colors"), COLORS, "colors")
    if colors:
        out["colors"] = colors
    map_colors = _colors(raw.get("map"), MAP_COLORS, "map")
    if map_colors:
        out["map"] = map_colors
    fonts = raw.get("fonts")
    if fonts is not None:
        if not isinstance(fonts, dict):
            raise ThemeError("fonts must be an object.")
        for role, font in fonts.items():
            if role not in FONT_ROLES or font not in FONTS:
                raise ThemeError(
                    "fonts.{0} must be one of: {1}.".format(
                        role, ", ".join(FONTS)
                    )
                )
        if fonts:
            out["fonts"] = dict(fonts)
    for key, allowed in (
        ("corners", CORNERS),
        ("overlay", OVERLAYS),
        ("stripe", STRIPES),
    ):
        if key in raw and raw[key] is not None:
            if raw[key] not in allowed:
                raise ThemeError(
                    "{0} must be one of: {1}.".format(key, ", ".join(allowed))
                )
            out[key] = raw[key]
    if raw.get("radius") is not None:
        r = raw["radius"]
        if not isinstance(r, (int, float)) or not 0 <= r <= 24:
            raise ThemeError("radius must be 0 to 24 (pixels).")
        out["radius"] = round(float(r), 1)
    if raw.get("glow") is not None:
        g = raw["glow"]
        if not isinstance(g, (int, float)) or not 0 <= g <= 1:
            raise ThemeError("glow must be 0 to 1.")
        out["glow"] = round(float(g), 2)
    return out


def clean_all(items) -> list[dict]:
    if not isinstance(items, list):
        raise ThemeError("themes must be a list.")
    if len(items) > MAX_CUSTOM:
        raise ThemeError("At most {0} custom themes.".format(MAX_CUSTOM))
    out: list[dict] = []
    seen: set[str] = set()
    for raw in items:
        theme = clean(raw, seen)
        seen.add(theme["id"])
        out.append(theme)
    return out


def known(theme_id: str | None, custom: list[dict]) -> bool:
    return bool(theme_id) and (
        theme_id in BUILTIN or any(t["id"] == theme_id for t in custom)
    )
