"""Request and response bodies."""

from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)

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


class AirPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    military: bool = True
    civil: bool = True
    focus: str = Field(default="", max_length=24)


class Preferences(BaseModel):
    """Per-user settings. Unknown keys are rejected to keep this small."""

    model_config = ConfigDict(extra="forbid")

    home: HomeLocation | None = None
    basemap: str | None = Field(default=None, max_length=16)
    left_open: bool | None = None
    right_open: bool | None = None
    layers: dict[str, bool] | None = None
    air: AirPreferences | None = None
    show_banner: bool | None = None


class MeOut(BaseModel):
    user: UserOut
    preferences: dict[str, Any]


class SetupStatus(BaseModel):
    needs_setup: bool


class Health(BaseModel):
    status: str
    version: str
    database: str
