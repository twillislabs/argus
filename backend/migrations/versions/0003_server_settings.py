"""Server-wide settings.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "server_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column(
            "updated_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("server_settings")
