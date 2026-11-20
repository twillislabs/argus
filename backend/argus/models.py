"""ORM models for accounts, sessions, setup and audit."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from argus.db import Base, UTCDateTime, utcnow
from argus.roles import ROLES  # noqa: F401 - kept importable from here


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stored lower-case; usernames are case-insensitive.
    username: Mapped[str] = mapped_column(String(32), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    # Set when an admin creates the account or resets its password: the
    # user must choose their own before doing anything else.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    password_changed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    # The database deletes preferences with the user (ON DELETE CASCADE);
    # without this the ORM tries to blank their key first and fails.
    preferences: Mapped["UserPreferences | None"] = relationship(
        back_populates="user",
        uselist=False,
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

    user: Mapped[User] = relationship(back_populates="preferences")


class UserSession(Base):
    """A signed-in browser. The id is the SHA-256 of the cookie token."""

    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    remember: Mapped[bool] = mapped_column(Boolean, default=False)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    user: Mapped[User] = relationship(lazy="joined")


class SetupToken(Base):
    __tablename__ = "setup_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


# --- Milestone 1: sources, raw records, events, articles -------------------

EVENT_TYPES = ("conflict", "unrest", "quake", "fire")
EVENT_STATUSES = ("candidate", "active", "expired")


class Source(Base):
    """One row per collector: schedule state and health."""

    __tablename__ = "sources"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(80))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    interval_s: Mapped[int] = mapped_column(Integer)
    last_run_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    last_success_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_count: Mapped[int] = mapped_column(Integer, default=0)
    # Collector-specific progress marker, e.g. the last GDELT file stamp.
    cursor: Mapped[str | None] = mapped_column(String(255), nullable=True)


class RawRecord(Base):
    """A record exactly as a source returned it (trimmed to useful fields)."""

    __tablename__ = "raw_records"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_raw_source_ext"),
        Index("ix_raw_records_observed_at", "observed_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(16))
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Event(Base):
    """A fused event shown on the map."""

    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_latlon", "lat", "lon"),
        Index("ix_events_last_updated", "last_updated"),
        Index("ix_events_type_status", "type", "status"),
    )

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    # Stable key for one-to-one sources (e.g. "usgs:us7000tz37").
    key: Mapped[str | None] = mapped_column(
        String(160), unique=True, nullable=True
    )
    type: Mapped[str] = mapped_column(String(16))
    severity: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(12), default="candidate")
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text, default="")
    place: Mapped[str] = mapped_column(String(200), default="")
    country: Mapped[str] = mapped_column(String(80), default="")
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    first_seen: Mapped[datetime] = mapped_column(UTCDateTime)
    last_updated: Mapped[datetime] = mapped_column(UTCDateTime)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    source_count: Mapped[int] = mapped_column(Integer, default=1)
    article_count: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class EventSource(Base):
    __tablename__ = "event_sources"

    event_id: Mapped[str] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    raw_record_id: Mapped[int] = mapped_column(
        ForeignKey("raw_records.id", ondelete="CASCADE"), primary_key=True
    )


class Article(Base):
    """A news article from an RSS / Atom feed."""

    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet: Mapped[str] = mapped_column(String(80))
    url: Mapped[str] = mapped_column(String(1000), unique=True)
    title: Mapped[str] = mapped_column(String(500))
    summary: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


# --- Milestone 2: server-wide settings --------------------------------------


class ServerSetting(Base):
    """One server-wide setting (set by an admin, used by every user).

    Secrets inside value (API keys) are encrypted with argus.secrets.
    """

    __tablename__ = "server_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


# --- Milestone 3: space ---------------------------------------------------


class Satellite(Base):
    """One object from the CelesTrak catalogue, with its latest elements.

    omm holds the CelesTrak GP record (OMM JSON) the browser propagates.
    """

    __tablename__ = "satellites"
    __table_args__ = (Index("ix_satellites_name", "name"),)

    norad_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    object_id: Mapped[str] = mapped_column(String(16), default="")
    # leo, meo, geo or heo, from the mean motion and eccentricity.
    orbit_class: Mapped[str] = mapped_column(String(4))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    epoch: Mapped[datetime] = mapped_column(UTCDateTime)
    omm: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class TensionDaily(Base):
    """Hourly tension samples per area, summed by day (see tension.py)."""

    __tablename__ = "tension_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    area: Mapped[str] = mapped_column(String(80), primary_key=True)
    total: Mapped[float] = mapped_column(Float, default=0.0)
    samples: Mapped[int] = mapped_column(Integer, default=0)


class AlprTile(Base):
    """ALPR cameras in one tile of the Overpass cache (argus/alpr.py),
    OpenStreetMap data (ODbL), refreshed after a day."""

    __tablename__ = "alpr_tiles"

    tile: Mapped[str] = mapped_column(String(24), primary_key=True)
    cameras: Mapped[list[Any]] = mapped_column(JSON, default=list)
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class NwsZone(Base):
    """An NWS forecast, marine or county zone's outline (simplified), for
    drawing zone-based alerts. Fetched by the worker as alerts need them."""

    __tablename__ = "nws_zones"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    rings: Mapped[list[Any]] = mapped_column(JSON, default=list)
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AlertRule(Base):
    """One user's alert rule (argus/alerts.py): what to watch for, in
    `params`, per `kind`. Deleted with the user (ON DELETE CASCADE)."""

    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(24))
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Push it (ntfy / webhook) as well as showing it in Argus.
    push: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_fired_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )


class AlertChannel(Base):
    """Where one user's alerts go. The ntfy topic and webhook URL are
    secrets (anyone with them can read or post), so they're encrypted."""

    __tablename__ = "alert_channels"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    ntfy_server: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ntfy_topic: Mapped[str | None] = mapped_column(Text, nullable=True)
    webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    webhook_format: Mapped[str] = mapped_column(String(12), default="json")
    # Argus's address as the user sees it, for links in pushed alerts.
    base_url: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Quiet hours (local "HH:MM" in tz): pushes wait, the bell doesn't.
    quiet_from: Mapped[str | None] = mapped_column(String(5), nullable=True)
    quiet_to: Mapped[str | None] = mapped_column(String(5), nullable=True)
    tz: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )


class Alert(Base):
    """An alert that fired, once per rule and key (an event id, an oblast
    alert's start ...), for the bell and so it's never sent twice."""

    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("rule_id", "key", name="uq_alert_rule_key"),
        Index("ix_alerts_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    rule_id: Mapped[int] = mapped_column(
        ForeignKey("alert_rules.id", ondelete="CASCADE")
    )
    key: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    # Where clicking it goes in Argus (a share link fragment).
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    severity: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    # "sent", "quiet" (held by quiet hours), "failed: ...", "off".
    pushed: Mapped[str | None] = mapped_column(String(120), nullable=True)
