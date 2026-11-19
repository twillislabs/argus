"""Tension index samples.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tension_daily",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("area", sa.String(80), primary_key=True),
        sa.Column("total", sa.Float(), nullable=False),
        sa.Column("samples", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("tension_daily")
