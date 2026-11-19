"""Plate reader (ALPR) camera tiles from OpenStreetMap, kept a day so an
API restart doesn't send every view back to Overpass.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alpr_tiles",
        sa.Column("tile", sa.String(24), primary_key=True),
        sa.Column("cameras", sa.JSON(), nullable=False),
        sa.Column("fetched_at", UTCDateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("alpr_tiles")
