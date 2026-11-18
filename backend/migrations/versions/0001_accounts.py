"""Accounts, sessions, setup tokens and audit log.

Revision ID: 0001
Revises:
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("last_login_at", UTCDateTime(), nullable=True),
        sa.Column("failed_logins", sa.Integer(), nullable=False),
        sa.Column("locked_until", UTCDateTime(), nullable=True),
    )
    op.create_table(
        "user_preferences",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("last_seen_at", UTCDateTime(), nullable=False),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.Column("remember", sa.Boolean(), nullable=False),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("ip", sa.String(45), nullable=True),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_table(
        "setup_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.Column("used_at", UTCDateTime(), nullable=True),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("at", UTCDateTime(), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_index("ix_audit_log_at", "audit_log", ["at"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("setup_tokens")
    op.drop_index("ix_user_sessions_user_id", "user_sessions")
    op.drop_table("user_sessions")
    op.drop_table("user_preferences")
    op.drop_table("users")
