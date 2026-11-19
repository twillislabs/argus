"""Request and response bodies."""

from datetime import datetime
from typing import Any, Literal
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
        self.capabilities = capabilities(self.role)
        return self


class AdminUserOut(UserOut):
    is_active: bool
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
    "cables",
    "bases",
    "sigmet",
)


class WallPrefs(BaseModel):
    """What a wall screen shows. Unset fields keep the built-in wall."""

    model_config = ConfigDict(extra="forbid")

    news: bool | None = None
    channel: str | None = Field(default=None, max_length=40)
    zones: list[WallClock] | None = Field(default=None, max_length=4)
    # None: home, then every theatre. One stop pins the screen there.
    stops: list[WallStop] | None = Field(default=None, max_length=30)
    stop_s: int | None = Field(default=None, ge=10, le=600)
    interrupt: bool | None = None
    layers: dict[str, bool] | None = None

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
    units: Literal["imperial", "metric"] | None = None
    show_route: bool | None = None
    # Wall page (/wall): news, clocks, tour and layers.
    wall: WallPrefs | None = None
    # Shapes and notes drawn on the map (map/drawTools.ts).
    drawings: list[dict[str, Any]] | None = Field(default=None, max_length=200)
    show_banner: bool | None = None


class MeOut(BaseModel):
    user: UserOut
    preferences: dict[str, Any]
    # Server-wide defaults set by an admin (layers, news, video).
    defaults: dict[str, Any] = {}


class SetupStatus(BaseModel):
    needs_setup: bool
    # Sign-in cookies are Secure (ARGUS_COOKIE_SECURE): browsers keep them
    # only over HTTPS (or on localhost), so the sign-in page can warn.
    secure_cookies: bool = True


class Health(BaseModel):
    status: str
    version: str
    database: str
