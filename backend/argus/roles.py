"""Roles and what each one may do.

Every signed-in user can use the map, search, follow aircraft and keep
their own preferences. Roles add to that:

    admin     everything: users, roles, server-wide settings
    analyst   the map plus analyst tools as they arrive (alerts, notes,
              watchlists, AI); no administration
    viewer    the map, read-only; no analyst tools
    display   a wall-screen account: like viewer, but its sessions don't
              time out when idle, and it can't change its own password
              or profile (an admin manages it)

Check a capability with can(role, "users.manage"); endpoints use
api.deps.require("users.manage").
"""

ROLES = ("admin", "analyst", "viewer", "display")

ROLE_LABELS = {
    "admin": "Administrator",
    "analyst": "Analyst",
    "viewer": "Viewer",
    "display": "Display (wall screen)",
}

CAPABILITIES: dict[str, set[str]] = {
    "admin": {
        "users.manage",
        "settings.manage",
        "backups.manage",
        "analyst.tools",
        "account.edit",
        "ai.use",
    },
    # ai.use: run AI features that spend the provider's tokens (Ask Argus,
    # summaries, refreshing the digest). Anyone can read the digest.
    "analyst": {"analyst.tools", "account.edit", "ai.use"},
    "viewer": {"account.edit"},
    "display": set(),
}


def can(role: str, capability: str) -> bool:
    return capability in CAPABILITIES.get(role, set())


def capabilities(role: str) -> list[str]:
    return sorted(CAPABILITIES.get(role, set()))
