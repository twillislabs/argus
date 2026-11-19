"""Runtime settings, read from ARGUS_* environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "change-me-in-production"  # noqa: S105 - sentinel


class Settings(BaseSettings):
    """All settings have safe defaults for a local Compose stack."""

    model_config = SettingsConfigDict(
        env_prefix="ARGUS_", env_file=".env", extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://argus:argus@db:5432/argus"
    secret_key: str = DEFAULT_SECRET
    log_level: str = "INFO"

    # Cookies are Secure by default. Set ARGUS_COOKIE_SECURE=false only
    # for plain-HTTP development on localhost.
    cookie_secure: bool = True

    session_idle_hours: int = 12
    session_max_days: int = 7
    session_remember_days: int = 30

    # First-run setup. A fixed token is useful for automated installs;
    # normally a random one is generated and printed to the log.
    setup_token: str | None = None
    setup_token_hours: int = 24

    # Message bus. Empty disables live push (the API then only serves
    # polled data).
    nats_url: str = "nats://nats:4222"

    # Collectors (worker process).
    collectors: str = (
        "usgs,gdelt,rss,firms,gdacs,eonet,tsunami,nga,faa_tfr,sigmet,czib,"
        "nws,spc"
    )
    user_agent: str = "Argus/0.1 (self-hosted OSINT visualizer)"
    firms_map_key: str | None = None
    # Optional JSON file overriding the default RSS feed list.
    rss_feeds_file: str | None = None
    # Military aircraft from adsb.lol, polled by the worker. Civil
    # aircraft are fetched by the API for the area in view.
    air_enabled: bool = True
    air_interval_s: int = 30
    # Satellite catalogue from CelesTrak, every six hours.
    space_enabled: bool = True
    # Vessels from AISStream (needs an admin's key in Settings).
    sea_enabled: bool = True
    raw_retention_days: int = 30
    event_retention_days: int = 30

    login_max_failures: int = 5
    login_lockout_minutes: int = 15
    login_ip_limit: int = 20
    login_ip_window_minutes: int = 15


@lru_cache
def get_settings() -> Settings:
    return Settings()
