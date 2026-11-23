"""AI features (argus/ai/): admin setup, the Brief digest, event
summaries and Ask Argus. Nothing here runs unless an admin turned the
feature on and gave it a provider.
"""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from argus import access, secrets
from argus.ai import config, features
from argus.ai.providers import AiError, run
from argus.api.deps import DbDep, SessionDep, SettingsDep, require
from argus.db import utcnow
from argus.models import Event, ServerSetting, UserPreferences, UserSession
from argus.services import audit

router = APIRouter(tags=["ai"])
log = logging.getLogger("argus.ai")
AdminDep = Depends(require("settings.manage"))
UseDep = Depends(require("ai.use"))

DIGEST_HOURS = 24
DIGEST_FRESH_S = 3600
ASKS_PER_HOUR = 40


class ProviderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None keeps the stored key; "" removes it.
    key: str | None = Field(default=None, max_length=400)
    model: str = Field(default="", max_length=120)
    base_url: str = Field(default="", max_length=300)


class FeatureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    on: bool = False
    provider: str = Field(
        default="anthropic", pattern="^(anthropic|openai|local)$"
    )
    model: str = Field(default="", max_length=120)


class AiSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    providers: dict[str, ProviderIn] = {}
    features: dict[str, FeatureIn] = {}
    monthly_tokens: int = Field(
        default=config.DEFAULT_CAP, ge=10_000, le=10**10
    )


class TestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(pattern="^(anthropic|openai|local)$")


class AskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=2, max_length=600)
    # The map's view, so "here" means something.
    view: list[float] | None = Field(default=None, min_length=4, max_length=4)


@router.get("/api/admin/ai", dependencies=[AdminDep])
async def get_ai(db: DbDep, settings: SettingsDep):
    value = await config.load(db)
    month = (await config.usage(db)).get(utcnow().strftime("%Y-%m")) or {}
    return config.public(value, settings.secret_key) | {"usage": month}


@router.put("/api/admin/ai")
async def put_ai(
    body: AiSettingsIn,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = AdminDep,
):
    value = await config.load(db)
    providers = dict(value.get("providers") or {})
    for kind, p in body.providers.items():
        if kind not in config.KINDS:
            raise HTTPException(422, "Unknown provider.")
        if p.base_url and not p.base_url.startswith(("http://", "https://")):
            raise HTTPException(
                422, "The base URL must start with http:// or https://."
            )
        cur = dict(providers.get(kind) or {})
        if p.key is not None:
            if p.key.strip():
                cur["key"] = secrets.encrypt(
                    settings.secret_key, p.key.strip()
                )
            else:
                cur.pop("key", None)
        cur["model"] = p.model.strip()
        cur["base_url"] = p.base_url.strip()
        providers[kind] = cur
    feats = dict(value.get("features") or {})
    for name, f in body.features.items():
        if name not in config.FEATURES:
            raise HTTPException(422, "Unknown AI feature.")
        feats[name] = f.model_dump()
    value = {
        "providers": providers,
        "features": feats,
        "monthly_tokens": body.monthly_tokens,
    }
    await config.save(db, value)
    await audit(db, "ai.settings", user_id=session.user_id, ip=None)
    await db.commit()
    return config.public(value, settings.secret_key)


@router.post("/api/admin/ai/test", dependencies=[AdminDep])
async def test_ai(body: TestIn, db: DbDep, settings: SettingsDep):
    value = await config.load(db)
    cfg = config.provider(value, body.provider, settings.secret_key)
    started = time.monotonic()
    try:
        result = await run(
            cfg,
            "You answer connection tests briefly.",
            "Reply with the single word: ready",
            max_tokens=2000,
            max_steps=1,
        )
    except AiError as exc:
        return {"ok": False, "error": str(exc)}
    await config.record(db, body.provider, "test", result)
    await db.commit()
    return {
        "ok": True,
        "model": result.model,
        "reply": result.text[:200],
        "seconds": round(time.monotonic() - started, 1),
    }


@router.get("/api/ai/status")
async def ai_status(session: SessionDep, db: DbDep):
    """Which AI features are on, and whether this user may run them."""
    value = await config.load(db)
    return {
        "features": {f: config.feature_on(value, f) for f in config.FEATURES},
        "can_use": await access.may(db, session.user, "ai.use"),
    }


async def _run_feature(db, settings, feature, system, prompt, **kw):
    value = await config.load(db)
    try:
        cfg = config.for_feature(value, feature, settings.secret_key)
        await config.check_cap(db, value)
        result = await run(cfg, system, prompt, **kw)
    except AiError as exc:
        raise HTTPException(409, str(exc)) from exc
    await config.record(db, cfg.kind, feature, result)
    return result


@router.get("/api/ai/digest")
async def get_digest(
    request: Request,
    session: SessionDep,
    db: DbDep,
    settings: SettingsDep,
    refresh: bool = False,
):
    """The last 24 hours in a few cited sentences. Cached an hour and
    shared; people who may use AI refresh it when it's stale."""
    value = await config.load(db)
    if not config.feature_on(value, "digest"):
        return {"status": "off"}
    row = await db.get(ServerSetting, "ai_digest")
    cached = dict(row.value) if row and row.value else None
    age = time.time() - float((cached or {}).get("at", 0))
    may = await access.may(db, session.user, "ai.use")
    if cached and (age < DIGEST_FRESH_S and not refresh or not may):
        return cached | {"status": "ok", "stale": age >= DIGEST_FRESH_S}
    if not may:
        return {"status": "none"}
    prompt, valid = await features.digest_input(db, DIGEST_HOURS)
    if not valid:
        return {"status": "empty"}
    result = await _run_feature(
        db, settings, "digest", features.DIGEST_SYSTEM, prompt, max_tokens=8000
    )
    sentences = features.cited_sentences(result.text, valid)
    body = {
        "sentences": sentences,
        "dropped": max(
            0, features.sentence_count(result.text) - len(sentences)
        ),
        "model": result.model,
        "generated": utcnow().isoformat(),
        "hours": DIGEST_HOURS,
        "at": time.time(),
    }
    if row is None:
        row = ServerSetting(key="ai_digest")
        db.add(row)
    row.value = body
    row.updated_at = utcnow()
    await db.commit()
    return body | {"status": "ok", "stale": False}


@router.post("/api/ai/events/{event_id}/summary")
async def summarize_event(
    event_id: str,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = UseDep,
):
    event = await db.get(Event, event_id[:16])
    if event is None:
        raise HTTPException(404, "No event with that id.")
    cache = getattr(request.app.state, "ai_summaries", None)
    if cache is None:
        cache = request.app.state.ai_summaries = {}
    key = "{0}@{1}".format(event.id, event.last_updated.isoformat())
    if key in cache:
        return cache[key]
    prompt = await features.summary_input(db, event)
    result = await _run_feature(
        db,
        settings,
        "summaries",
        features.SUMMARY_SYSTEM,
        prompt,
        max_tokens=6000,
    )
    await db.commit()
    body = {"summary": result.text[:3000], "model": result.model}
    cache[key] = body
    if len(cache) > 500:
        cache.pop(next(iter(cache)))
    return body


@router.post("/api/ai/ask")
async def ask(
    body: AskIn,
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = UseDep,
):
    state = request.app.state
    if not hasattr(state, "ai_asks"):
        state.ai_asks = {}
    now = time.time()
    recent = [
        t for t in state.ai_asks.get(session.user_id, []) if now - t < 3600
    ]
    if len(recent) >= ASKS_PER_HOUR:
        raise HTTPException(
            429, "That's a lot of questions this hour; try again later."
        )
    state.ai_asks[session.user_id] = recent + [now]
    tools = features.AskTools(db, state)
    prompt = body.question.strip()
    prefs = await db.get(UserPreferences, session.user_id)
    home = ((prefs.data if prefs else None) or {}).get("home")
    if home and home.get("lat") is not None:
        prompt += (
            "\n\n(The analyst's home is {0} at lat {1:.3f}, lon {2:.3f}, "
            "watching {3} km around it.)"
        ).format(
            home.get("name") or "home",
            float(home["lat"]),
            float(home["lon"]),
            int(home.get("radius_km") or 300),
        )
    if body.view:
        prompt += "\n\n(The analyst's map shows bbox {0}.)".format(
            [round(x, 3) for x in body.view]
        )
    result = await _run_feature(
        db,
        settings,
        "ask",
        features.ASK_SYSTEM,
        prompt,
        tools=features.ASK_TOOLS,
        execute=tools,
        max_tokens=8000,
        max_steps=8,
    )
    await db.commit()
    # Keep citations to events the tools actually returned.
    text = features.CITE.sub(
        lambda m: m.group(0) if m.group(1) in tools.seen_events else "",
        result.text,
    )
    return {
        "answer": text[:6000],
        "events": sorted(tools.seen_events & set(features.CITE.findall(text))),
        "view": tools.view,
        "tools": [c["tool"] for c in result.calls],
        "model": result.model,
    }
