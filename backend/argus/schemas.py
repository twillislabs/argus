"""Request and response bodies."""

from datetime import datetime
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from argus.roles import capabilities

USERNAME_PATTERN = r"^[A-Za-z0-9._-]{3,32}$"


class HomeLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_km: int = Field(default=500, ge=10, le=5000)
    tz: str = Field(min_length=1, max_length=64)

    @field_validator("tz")
    @classmethod
    def known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("unknown time zone") from exc
        return value


class SetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=64)
    username: str = Field(pattern=USERNAME_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr | None = None
    password: str = Field(min_length=1, max_length=256)
    home: HomeLocation | None = None


class SignupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(pattern=USERNAME_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr | None = None
    password: str = Field(min_length=1, max_length=256)


class SignupSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Anyone who can reach Argus may make an account.
    open: bool = False
    # New accounts can't sign in until an admin approves them.
    approval: bool = True
    # The role a new account gets (never admin).
    role: Literal["viewer", "analyst"] = "viewer"


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    email: str | None
    role: str
    must_change_password: bool = False
    capabilities: list[str] = []

    @model_validator(mode="after")
    def fill_capabilities(self):
        # The role's, unless already set: /api/me sets what the user may
        # actually do (argus/access.py), and must survive revalidation.
        if not self.capabilities:
            self.capabilities = capabilities(self.role)
        return self


class AdminUserOut(UserOut):
    is_active: bool
    approval_pending: bool = False
    created_at: datetime
    last_login_at: datetime | None
    locked_until: datetime | None


Role = Literal["admin", "analyst", "viewer", "display"]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(pattern=USERNAME_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    email: EmailStr | None = None
    role: Role = "viewer"


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: EmailStr | None = None
    role: Role | None = None
    is_active: bool | None = None


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: EmailStr | None = None


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class AirPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    military: bool = True
    civil: bool = True
    focus: str = Field(default="", max_length=24)


class WallClock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=24)
    tz: str = Field(min_length=1, max_length=64)

    @field_validator("tz")
    @classmethod
    def known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("unknown time zone") from exc
        return value


class WallStop(BaseModel):
    """One stop on a wall screen's tour: home, every theatre (most tense
    first), one theatre by key, or a place."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["home", "theatres", "theatre", "place"]
    key: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, max_length=80)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    height: float | None = Field(default=None, ge=500, le=40_000_000)

    @model_validator(mode="after")
    def complete(self) -> "WallStop":
        if self.kind == "theatre" and not self.key:
            raise ValueError("a theatre stop needs its key")
        if self.kind == "place" and (
            self.lat is None or self.lon is None or not self.name
        ):
            raise ValueError("a place stop needs a name, lat and lon")
        return self


WALL_LAYERS = (
    "tension",
    "events",
    "aircraft",
    "czib",
    "gps",
    "nuclear",
    "power",
    "cables",
    "bases",
    "sigmet",
    "tfr",
    "ships",
    "wx_alerts",
    "wx_zones",
    "wx_outlook",
    "wx_storms",
    "radar",
    "lightning",
    "clouds",
    "vapour",
    "precip",
    "sst",
    "wind",
    "stations",
    "advisories",
    "wiki",
)
# Parts of the wall that can be shown or hidden.
WALL_SECTIONS = (
    "header",
    "clocks",
    "tension",
    "kpis",
    "top",
    "news",
    "weather",
    "caption",
    "ticker",
)


class WallPrefs(BaseModel):
    """What a wall screen shows. Unset fields keep the built-in wall."""

    model_config = ConfigDict(extra="forbid")

    news: bool | None = None
    channel: str | None = Field(default=None, max_length=40)
    # "tv": live TV fills the screen (tv_channels: one full screen, or
    # up to four in a grid) instead of the map.
    mode: Literal["map", "tv"] | None = None
    tv_channels: list[str] | None = Field(default=None, max_length=4)
    # The live TV's sound (the first channel only, in a grid).
    muted: bool | None = None
    volume: int | None = Field(default=None, ge=0, le=100)
    zones: list[WallClock] | None = Field(default=None, max_length=4)
    # None: home, then every theatre. One stop pins the screen there.
    stops: list[WallStop] | None = Field(default=None, max_length=30)
    stop_s: int | None = Field(default=None, ge=10, le=600)
    interrupt: bool | None = None
    layers: dict[str, bool] | None = None
    sections: dict[str, bool] | None = None

    @field_validator("tv_channels")
    @classmethod
    def short_ids(cls, value: list[str] | None):
        if value is not None and any(
            not c
            or len(c) > 40
            or not c.replace("-", "").replace("_", "").isalnum()
            for c in value
        ):
            raise ValueError("tv_channels must be channel ids")
        return value

    @field_validator("sections")
    @classmethod
    def known_sections(cls, value: dict[str, bool] | None):
        if value is not None:
            unknown = set(value) - set(WALL_SECTIONS)
            if unknown:
                raise ValueError(
                    "unknown wall sections: {0}".format(
                        ", ".join(sorted(unknown))
                    )
                )
        return value

    @field_validator("layers")
    @classmethod
    def known_layers(cls, value: dict[str, bool] | None):
        if value is not None:
            unknown = set(value) - set(WALL_LAYERS)
            if unknown:
                raise ValueError(
                    "unknown wall layers: {0}".format(
                        ", ".join(sorted(unknown))
                    )
                )
        return value


class WallProfileIn(BaseModel):
    """A named wall setup that screens can follow."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)
    wall: WallPrefs


# A map camera: lon,lat,height[,heading,pitch] (GlobeHandle.cameraString).
CAMERA_TEXT = (
    r"^-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?,\d{1,8}(,-?\d{1,3}(\.\d+)?){0,2}$"
)


class TourShot(BaseModel):
    """One shot of a director-mode tour: a view and a caption."""

    model_config = ConfigDict(extra="forbid")

    camera: str = Field(max_length=60, pattern=CAMERA_TEXT)
    caption: str = Field(default="", max_length=200)
    fly_s: float = Field(default=3, ge=0, le=30)
    hold_s: float = Field(default=6, ge=1, le=600)


class Tour(BaseModel):
    """A saved director-mode tour (map camera moves with captions)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=60)
    loop: bool = False
    shots: list[TourShot] = Field(default_factory=list, max_length=40)


BRIEF_SECTIONS = (
    "us_stories",
    "us_events",
    "theatres",
    "digest",
    "world_stories",
    "world_events",
    "changes",
    "wiki",
    "tension",
    "kev",
    "space",
    "sources",
)


class BriefPrefs(BaseModel):
    """The Brief's sections in the order shown, and the hidden ones."""

    model_config = ConfigDict(extra="forbid")

    order: list[str] = Field(default_factory=list, max_length=40)
    hidden: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("order", "hidden")
    @classmethod
    def known_sections(cls, value: list[str]) -> list[str]:
        # Unknown ids (a section since removed) are dropped, not refused.
        return [s for s in dict.fromkeys(value) if s in BRIEF_SECTIONS]


class Preferences(BaseModel):
    """Per-user settings. Unknown keys are rejected to keep this small."""

    model_config = ConfigDict(extra="forbid")

    home: HomeLocation | None = None
    basemap: str | None = Field(default=None, max_length=16)
    left_open: bool | None = None
    right_open: bool | None = None
    layers: dict[str, bool] | None = None
    air: AirPreferences | None = None
    reference: dict[str, bool] | None = None
    space: dict[str, bool] | None = None
    sea: dict[str, bool] | None = None
    airspace: dict[str, bool] | None = None
    infra: dict[str, bool] | None = None
    news: dict[str, Any] | None = None
    tension: bool | None = None
    wiki: bool | None = None
    cams: dict[str, bool] | None = None
    weather: dict[str, bool] | None = None
    # Weather imagery opacity by layer (map/wxLayer.ts WX_IMAGERY), 0-1.
    weather_opacity: dict[str, Annotated[float, Field(ge=0, le=1)]] | None = (
        None
    )
    units: Literal["imperial", "metric"] | None = None
    # How often the map redraws when nothing moves (map/render.ts).
    render: Literal["smooth", "balanced", "saver"] | None = None
    show_route: bool | None = None
    # Wall page (/wall): news, clocks, tour and layers.
    wall: WallPrefs | None = None
    # A wall profile to follow instead (server_settings wall_profiles).
    wall_profile: str | None = Field(default=None, max_length=40)
    # Shapes and notes drawn on the map (map/drawTools.ts).
    drawings: list[dict[str, Any]] | None = Field(default=None, max_length=200)
    show_banner: bool | None = None
    # The selected traffic camera's picture drawn in the 3D scene.
    cam_picture: bool | None = None
    # A built-in or custom theme id (null: the server default).
    theme: str | None = Field(
        default=None, pattern=r"^[a-z0-9][a-z0-9-]{0,39}$"
    )
    # Director mode: saved map tours (TourPanel).
    tours: list[Tour] | None = Field(default=None, max_length=30)
    brief: BriefPrefs | None = None


class MeOut(BaseModel):
    user: UserOut
    preferences: dict[str, Any]
    # Server-wide defaults set by an admin (layers, news, video).
    defaults: dict[str, Any] = {}
    # The live channels the news player offers (Settings > Live channels).
    channels: list[dict[str, Any]] = []
    # Custom themes an admin made (Settings > Themes).
    themes: list[dict[str, Any]] = []
    # Accounts waiting for approval (only for those who manage users).
    pending_signups: int = 0


class SetupStatus(BaseModel):
    needs_setup: bool
    # Anyone may make an account (Settings > Users > Sign-ups).
    signup: bool = False
    # Sign-in cookies are Secure (ARGUS_COOKIE_SECURE): browsers keep them
    # only over HTTPS (or on localhost), so the sign-in page can warn.
    secure_cookies: bool = True


class Health(BaseModel):
    status: str
    version: str
    database: str
