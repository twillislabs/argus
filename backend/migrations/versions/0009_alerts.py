"""Alerts: each user's rules, delivery channels and alert history.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("push", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("last_fired_at", UTCDateTime(), nullable=True),
    )
    op.create_index("ix_alert_rules_user_id", "alert_rules", ["user_id"])
    op.create_table(
        "alert_channels",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("ntfy_server", sa.String(200), nullable=True),
        sa.Column("ntfy_topic", sa.Text(), nullable=True),
        sa.Column("webhook_url", sa.Text(), nullable=True),
        sa.Column("webhook_format", sa.String(12), nullable=False),
        sa.Column("base_url", sa.String(200), nullable=True),
        sa.Column("quiet_from", sa.String(5), nullable=True),
        sa.Column("quiet_to", sa.String(5), nullable=True),
        sa.Column("tz", sa.String(64), nullable=True),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("alert_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(120), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("link", sa.String(300), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("severity", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("pushed", sa.String(120), nullable=True),
        sa.UniqueConstraint("rule_id", "key", name="uq_alert_rule_key"),
    )
    op.create_index(
        "ix_alerts_user_created", "alerts", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_alerts_user_created", table_name="alerts")
    op.drop_table("alerts")
    op.drop_table("alert_channels")
    op.drop_index("ix_alert_rules_user_id", table_name="alert_rules")
    op.drop_table("alert_rules")
