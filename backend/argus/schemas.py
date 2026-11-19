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
    units: Literal["imperial", "metric"] | None = None
    show_route: bool | None = None
    # Shapes and notes drawn on the map (map/drawTools.ts).
    drawings: list[dict[str, Any]] | None = Field(default=None, max_length=200)
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
