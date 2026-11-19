"""NWS zone shapes, fetched on demand for zone-based alerts.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nws_zones",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("rings", sa.JSON(), nullable=False),
        sa.Column("fetched_at", UTCDateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("nws_zones")
