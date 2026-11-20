"""The admin's AI setup, in server_settings["ai"]:

    {"providers": {"anthropic": {"key": <encrypted>, "model": "..."},
                   "openai": {"key": <encrypted>, "model": "..."},
                   "local": {"base_url": "...", "model": "...",
                             "key": <encrypted, optional>}},
     "features": {"digest": {"on": true, "provider": "anthropic",
                             "model": ""}, "summaries": {...},
                  "ask": {...}},
     "monthly_tokens": 2000000}

Keys are encrypted with ARGUS_SECRET_KEY and only ever shown as a hint.
Usage is counted per month and provider in server_settings["ai_usage"];
a feature stops (with a message) once the month's token cap is reached.
"""

from datetime import UTC, datetime
from typing import Any

from argus import secrets
from argus.ai.providers import DEFAULT_MODELS, AiError, ProviderConfig
from argus.db import utcnow
from argus.models import ServerSetting

KINDS = ("anthropic", "openai", "local")
FEATURES = ("digest", "summaries", "ask")
FEATURE_LABELS = {
    "digest": "Brief digest",
    "summaries": "Event summaries",
    "ask": "Ask Argus",
}
DEFAULT_CAP = 2_000_000


async def load(db) -> dict:
    row = await db.get(ServerSetting, "ai")
    return dict(row.value) if row and row.value else {}


async def save(db, value: dict) -> None:
    row = await db.get(ServerSetting, "ai")
    if row is None:
        row = ServerSetting(key="ai")
        db.add(row)
    row.value = value
    row.updated_at = utcnow()


def public(value: dict, secret_key: str) -> dict:
    """What admins see: models and base URLs, key hints, never keys."""
    providers = {}
    for kind in KINDS:
        p = (value.get("providers") or {}).get(kind) or {}
        key = secrets.decrypt(secret_key, p["key"]) if p.get("key") else None
        providers[kind] = {
            "model": p.get("model") or DEFAULT_MODELS[kind],
            "base_url": p.get("base_url") or "",
            "key_hint": secrets.hint(key) if key else None,
            "configured": bool(key)
            or (kind == "local" and bool(p.get("base_url"))),
        }
    features = {}
    for f in FEATURES:
        cfg = (value.get("features") or {}).get(f) or {}
        features[f] = {
            "on": bool(cfg.get("on")),
            "provider": cfg.get("provider") or "anthropic",
            "model": cfg.get("model") or "",
            "label": FEATURE_LABELS[f],
        }
    return {
        "providers": providers,
        "features": features,
        "monthly_tokens": int(value.get("monthly_tokens") or DEFAULT_CAP),
    }


def provider(
    value: dict, kind: str, secret_key: str, model: str = ""
) -> ProviderConfig:
    p = (value.get("providers") or {}).get(kind) or {}
    key = secrets.decrypt(secret_key, p["key"]) if p.get("key") else None
    return ProviderConfig(
        kind=kind,
        model=model or p.get("model") or DEFAULT_MODELS.get(kind, ""),
        api_key=key,
        base_url=p.get("base_url") or None,
    )


def for_feature(value: dict, feature: str, secret_key: str) -> ProviderConfig:
    """The provider a feature uses, or AiError if it's off or unset."""
    cfg = (value.get("features") or {}).get(feature) or {}
    if not cfg.get("on"):
        raise AiError(
            "{0} isn't turned on (Settings > AI).".format(
                FEATURE_LABELS[feature]
            )
        )
    kind = cfg.get("provider") or "anthropic"
    if kind not in KINDS:
        raise AiError("Unknown provider.")
    return provider(value, kind, secret_key, cfg.get("model") or "")


def feature_on(value: dict, feature: str) -> bool:
    return bool(((value.get("features") or {}).get(feature) or {}).get("on"))


def _month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


async def usage(db) -> dict:
    row = await db.get(ServerSetting, "ai_usage")
    return dict(row.value) if row and row.value else {}


async def check_cap(db, value: dict) -> None:
    month = (await usage(db)).get(_month()) or {}
    used = sum(
        int(p.get("input", 0)) + int(p.get("output", 0))
        for p in month.values()
    )
    cap = int(value.get("monthly_tokens") or DEFAULT_CAP)
    if used >= cap:
        raise AiError(
            "This month's AI token cap ({0:,}) is used up; raise it in "
            "Settings > AI.".format(cap)
        )


async def record(db, kind: str, feature: str, result: Any) -> None:
    row = await db.get(ServerSetting, "ai_usage")
    if row is None:
        row = ServerSetting(key="ai_usage", value={})
        db.add(row)
    value = dict(row.value or {})
    month = dict(value.get(_month()) or {})
    p = dict(month.get(kind) or {})
    p["input"] = int(p.get("input", 0)) + int(result.input_tokens)
    p["output"] = int(p.get("output", 0)) + int(result.output_tokens)
    p["calls"] = int(p.get("calls", 0)) + 1
    by = dict(p.get("features") or {})
    by[feature] = int(by.get(feature, 0)) + 1
    p["features"] = by
    month[kind] = p
    value[_month()] = month
    # Keep a year.
    for old in sorted(value)[:-12]:
        value.pop(old, None)
    row.value = value
    row.updated_at = utcnow()
