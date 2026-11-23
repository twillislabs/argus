"""User groups, for limiting features to chosen people (Settings >
Users & roles > Groups and Feature access).

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

from argus.db import UTCDateTime

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False, unique=True),
        sa.Column("description", sa.String(200), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "user_group_members",
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("user_groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_user_group_members_user_id", "user_group_members", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_user_group_members_user_id", "user_group_members")
    op.drop_table("user_group_members")
    op.drop_table("user_groups")
