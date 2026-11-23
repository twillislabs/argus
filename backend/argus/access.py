"""Feature access: limiting some features to chosen groups and people.

Roles say what each kind of account may do (argus/roles.py). On top of
that an admin can limit a few features (RESTRICTABLE) to chosen user
groups and people (Settings > Users & roles > Feature access). A
feature's rule is kept in server_settings["access"]:

    {"ai.use": {"mode": "only", "groups": [3], "users": [7]}, ...}

mode "role" (the default): everyone whose role has the capability.
mode "only": the role must have it AND the person must be listed, or be
in a listed group. Administrators always keep every feature, so nobody
can lock the server's admins out.

capabilities_for() is the one place that answers "may this person do
this"; deps.require(), /api/me and the AI and token checks use it.
"""

import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from argus.models import ServerSetting, User, UserGroupMember
from argus.roles import capabilities

KEY = "access"
RESTRICTABLE = {
    "ai.use": (
        "AI",
        "Ask Argus, event summaries and refreshing the digest (spends the "
        "AI provider's tokens). Anyone can still read the digest.",
    ),
    "alerts.use": (
        "Alerts",
        "Their own alert rules, and delivery to ntfy or webhooks.",
    ),
    "api.tokens": (
        "API tokens and AI assistants",
        "Read-only API tokens and the MCP server for Claude and other "
        "assistants. Tokens of people who lose this stop working.",
    ),
    "video.search": (
        "Live video search",
        "Live near the view and video about an event (spends the YouTube "
        "key's quota).",
    ),
}
CACHE_S = 5.0
_cache: dict[str, tuple[float, dict]] = {}


def clean_rules(raw) -> dict:
    """Rules as stored: known features only, mode role|only, int ids."""
    out: dict[str, dict] = {}
    if not isinstance(raw, dict):
        return out
    for feature, rule in raw.items():
        if feature not in RESTRICTABLE or not isinstance(rule, dict):
            continue
        mode = (
            rule.get("mode")
            if rule.get("mode") in ("role", "only")
            else "role"
        )
        ids = {}
        for k in ("groups", "users"):
            vals = rule.get(k) or []
            ids[k] = sorted(
                {int(v) for v in vals if isinstance(v, int) and v > 0}
            )[:500]
        out[feature] = {"mode": mode, **ids}
    return out


async def rules(db: AsyncSession) -> dict:
    hit = _cache.get(KEY)
    if hit and time.monotonic() - hit[0] < CACHE_S:
        return hit[1]
    row = await db.get(ServerSetting, KEY)
    found = clean_rules(row.value if row else {})
    _cache[KEY] = (time.monotonic(), found)
    return found


def forget() -> None:
    """After saving rules or groups: no stale answers."""
    _cache.clear()


async def user_group_ids(db: AsyncSession, user_id: int) -> set[int]:
    rows = await db.execute(
        select(UserGroupMember.group_id).where(
            UserGroupMember.user_id == user_id
        )
    )
    return set(rows.scalars())


async def capabilities_for(db: AsyncSession, user: User) -> list[str]:
    """What this person may do: their role's capabilities, minus
    limited features they aren't given."""
    caps = set(capabilities(user.role))
    if user.role == "admin":
        return sorted(caps)
    limited = {
        f: r
        for f, r in (await rules(db)).items()
        if r["mode"] == "only" and f in caps
    }
    if not limited:
        return sorted(caps)
    groups = await user_group_ids(db, user.id)
    for feature, rule in limited.items():
        if user.id not in rule["users"] and not groups & set(rule["groups"]):
            caps.discard(feature)
    return sorted(caps)


async def may(db: AsyncSession, user: User, capability: str) -> bool:
    return capability in await capabilities_for(db, user)
