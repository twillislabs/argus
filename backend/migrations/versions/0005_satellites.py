"""Satellite catalogue.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "satellites",
        sa.Column("norad_id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("object_id", sa.String(16), nullable=False),
        sa.Column("orbit_class", sa.String(4), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("epoch", UTCDateTime(), nullable=False),
        sa.Column("omm", sa.JSON(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_satellites_name", "satellites", ["name"])


def downgrade() -> None:
    op.drop_index("ix_satellites_name", table_name="satellites")
    op.drop_table("satellites")
