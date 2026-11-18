"""Sources, raw records, events and articles.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sources",
        sa.Column("name", sa.String(32), primary_key=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("interval_s", sa.Integer(), nullable=False),
        sa.Column("last_run_at", UTCDateTime(), nullable=True),
        sa.Column("last_success_at", UTCDateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_count", sa.Integer(), nullable=False),
        sa.Column("cursor", sa.String(255), nullable=True),
    )
    op.create_table(
        "raw_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("fetched_at", UTCDateTime(), nullable=False),
        sa.Column("observed_at", UTCDateTime(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.UniqueConstraint("source", "external_id", name="uq_raw_source_ext"),
    )
    op.create_index(
        "ix_raw_records_observed_at", "raw_records", ["observed_at"]
    )
    op.create_table(
        "events",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("key", sa.String(160), nullable=True, unique=True),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("place", sa.String(200), nullable=False),
        sa.Column("country", sa.String(80), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("first_seen", UTCDateTime(), nullable=False),
        sa.Column("last_updated", UTCDateTime(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source_count", sa.Integer(), nullable=False),
        sa.Column("article_count", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_events_latlon", "events", ["lat", "lon"])
    op.create_index("ix_events_last_updated", "events", ["last_updated"])
    op.create_index("ix_events_type_status", "events", ["type", "status"])
    op.create_table(
        "event_sources",
        sa.Column(
            "event_id",
            sa.String(16),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "raw_record_id",
            sa.Integer(),
            sa.ForeignKey("raw_records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "articles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("outlet", sa.String(80), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False, unique=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("published_at", UTCDateTime(), nullable=False),
        sa.Column("fetched_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_articles_published_at", "articles", ["published_at"])


def downgrade() -> None:
    op.drop_table("articles")
    op.drop_table("event_sources")
    op.drop_table("events")
    op.drop_table("raw_records")
    op.drop_table("sources")
