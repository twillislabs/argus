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

    login_max_failures: int = 5
    login_lockout_minutes: int = 15
    login_ip_limit: int = 20
    login_ip_window_minutes: int = 15


@lru_cache
def get_settings() -> Settings:
    return Settings()
