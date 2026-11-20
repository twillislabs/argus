"""Alerts (argus/alerts.py): your own rules, where they're delivered,
a test push, and the alerts that fired (the bell)."""

from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, update

from argus import alerts, secrets
from argus.api.deps import DbDep, SettingsDep, require
from argus.db import utcnow
from argus.models import Alert, AlertChannel, AlertRule, UserSession

router = APIRouter(tags=["alerts"])
UseDep = Depends(require("alerts.use"))
MAX_RULES = 50
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class Area(BaseModel):
    model_config = ConfigDict(extra="forbid")

    center: list[float] | None = Field(
        default=None, min_length=2, max_length=2
    )
    radius_km: float | None = Field(default=None, gt=0, le=5000)
    ring: list[list[float]] | None = Field(default=None, max_length=500)
    label: str = Field(default="", max_length=80)

    @field_validator("ring")
    @classmethod
    def points(cls, v):
        if v is not None and (len(v) < 3 or any(len(p) != 2 for p in v)):
            raise ValueError("an area needs at least three points")
        return v


class EventsParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    area: Area | None = None
    min_severity: int = Field(default=4, ge=1, le=5)
    types: list[
        Literal["conflict", "unrest", "quake", "fire", "hazard", "maritime"]
    ] = []


class RaidsParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ukraine: list[str] = Field(default_factory=list, max_length=30)
    israel: bool = False
    israel_area: Area | None = None


class AirportParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codes: list[str] = Field(min_length=1, max_length=20)
    levels: list[Literal["stop", "delay"]] = ["stop"]

    @field_validator("codes")
    @classmethod
    def iata(cls, v):
        out = [c.strip().upper() for c in v]
        if any(not (3 <= len(c) <= 4 and c.isalnum()) for c in out):
            raise ValueError("airport codes are 3 or 4 letters")
        return out


class PatternParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    air: bool = True
    sea: bool = True
    area: Area | None = None


class WatchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    aircraft: list[str] = Field(default_factory=list, max_length=50)
    vessels: list[int] = Field(default_factory=list, max_length=50)
    area: Area | None = None


class SpaceParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    g_min: int = Field(default=3, ge=1, le=5)


PARAMS = {
    "events": EventsParams,
    "raids": RaidsParams,
    "airport": AirportParams,
    "pattern": PatternParams,
    "watch": WatchParams,
    "space": SpaceParams,
}


class RuleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    kind: Literal["events", "raids", "airport", "pattern", "watch", "space"]
    params: dict = {}
    enabled: bool = True
    push: bool = True


class ChannelsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ntfy_server: str = Field(default="", max_length=200)
    # None keeps the stored value; "" removes it.
    ntfy_topic: str | None = Field(default=None, max_length=200)
    webhook_url: str | None = Field(default=None, max_length=1000)
    webhook_format: Literal["json", "discord", "slack"] = "json"
    base_url: str = Field(default="", max_length=200)
    quiet_from: str = Field(default="", pattern="^$|{0}".format(HHMM))
    quiet_to: str = Field(default="", pattern="^$|{0}".format(HHMM))
    tz: str = Field(default="", max_length=64)


class ReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[int] = Field(default_factory=list, max_length=500)
    all: bool = False


def _clean(kind: str, params: dict) -> dict:
    try:
        return PARAMS[kind](**(params or {})).model_dump(exclude_none=True)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Rule settings: {0}".format(exc)) from exc


def _rule(r: AlertRule) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "kind": r.kind,
        "params": r.params,
        "enabled": r.enabled,
        "push": r.push,
        "created_at": r.created_at.isoformat(),
        "last_fired_at": r.last_fired_at.isoformat()
        if r.last_fired_at
        else None,
    }


async def _mine(db, session, rule_id: int) -> AlertRule:
    r = await db.get(AlertRule, rule_id)
    if r is None or r.user_id != session.user_id:
        raise HTTPException(404, "No such alert rule.")
    return r


@router.get("/api/alert-rules")
async def list_rules(db: DbDep, session: UserSession = UseDep):
    rows = (
        await db.execute(
            select(AlertRule)
            .where(AlertRule.user_id == session.user_id)
            .order_by(AlertRule.id)
        )
    ).scalars()
    return {"rules": [_rule(r) for r in rows]}


@router.post("/api/alert-rules", status_code=201)
async def create_rule(body: RuleIn, db: DbDep, session: UserSession = UseDep):
    count = (
        await db.execute(
            select(func.count())
            .select_from(AlertRule)
            .where(AlertRule.user_id == session.user_id)
        )
    ).scalar_one()
    if count >= MAX_RULES:
        raise HTTPException(409, "You can have up to 50 alert rules.")
    r = AlertRule(
        user_id=session.user_id,
        name=body.name.strip(),
        kind=body.kind,
        params=_clean(body.kind, body.params),
        enabled=body.enabled,
        push=body.push,
        created_at=utcnow(),
    )
    db.add(r)
    await db.commit()
    return _rule(r)


@router.put("/api/alert-rules/{rule_id}")
async def update_rule(
    rule_id: int, body: RuleIn, db: DbDep, session: UserSession = UseDep
):
    r = await _mine(db, session, rule_id)
    r.name = body.name.strip()
    if body.kind != r.kind:
        # A new kind of rule starts counting afresh.
        r.created_at = utcnow()
    r.kind = body.kind
    r.params = _clean(body.kind, body.params)
    if body.enabled and not r.enabled:
        # Back on: don't fire for everything that happened while off.
        r.created_at = utcnow()
    r.enabled = body.enabled
    r.push = body.push
    await db.commit()
    return _rule(r)


@router.delete("/api/alert-rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: DbDep, session: UserSession = UseDep):
    r = await _mine(db, session, rule_id)
    await db.delete(r)
    await db.commit()


def _channels(ch: AlertChannel | None, secret_key: str) -> dict:
    def hint(value):
        plain = secrets.decrypt(secret_key, value) if value else None
        return secrets.hint(plain) if plain else None

    return {
        "ntfy_server": (ch.ntfy_server if ch else None) or "",
        "ntfy_topic_hint": hint(ch.ntfy_topic) if ch else None,
        "webhook_hint": hint(ch.webhook_url) if ch else None,
        "webhook_format": ch.webhook_format if ch else "json",
        "base_url": (ch.base_url if ch else None) or "",
        "quiet_from": (ch.quiet_from if ch else None) or "",
        "quiet_to": (ch.quiet_to if ch else None) or "",
        "tz": (ch.tz if ch else None) or "",
        "default_ntfy": alerts.NTFY_DEFAULT,
    }


@router.get("/api/alerts/channels")
async def get_channels(
    db: DbDep, settings: SettingsDep, session: UserSession = UseDep
):
    return _channels(
        await db.get(AlertChannel, session.user_id), settings.secret_key
    )


@router.put("/api/alerts/channels")
async def put_channels(
    body: ChannelsIn,
    db: DbDep,
    settings: SettingsDep,
    session: UserSession = UseDep,
):
    if body.ntfy_server and not alerts.url_allowed(body.ntfy_server):
        raise HTTPException(422, "That ntfy server address isn't allowed.")
    if body.webhook_url and not alerts.url_allowed(body.webhook_url):
        raise HTTPException(
            422,
            "That webhook address isn't allowed (http or https, and not "
            "this server itself).",
        )
    ch = await db.get(AlertChannel, session.user_id)
    if ch is None:
        ch = AlertChannel(user_id=session.user_id)
        db.add(ch)
    ch.ntfy_server = body.ntfy_server.strip() or None
    for field in ("ntfy_topic", "webhook_url"):
        value = getattr(body, field)
        if value is not None:
            setattr(
                ch,
                field,
                secrets.encrypt(settings.secret_key, value.strip())
                if value.strip()
                else None,
            )
    ch.webhook_format = body.webhook_format
    ch.base_url = body.base_url.strip() or None
    ch.quiet_from = body.quiet_from or None
    ch.quiet_to = body.quiet_to or None
    ch.tz = body.tz.strip() or None
    ch.updated_at = utcnow()
    await db.commit()
    return _channels(ch, settings.secret_key)


@router.post("/api/alerts/test")
async def test_push(
    db: DbDep, settings: SettingsDep, session: UserSession = UseDep
):
    """Send a test alert to your ntfy topic and webhook."""
    ch = await db.get(AlertChannel, session.user_id)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0),
        headers={"User-Agent": settings.user_agent},
    ) as client:
        result = await alerts.deliver(
            client,
            ch,
            settings.secret_key,
            {
                "title": "Argus test alert",
                "body": "Alerts from Argus will arrive like this.",
                "link": "#",
                "severity": 3,
                "kind": "test",
                "rule": "Test",
            },
        )
    return {"result": result}


@router.get("/api/alerts")
async def list_alerts(
    db: DbDep,
    session: UserSession = UseDep,
    limit: int = Query(50, ge=1, le=200),
):
    rows = (
        await db.execute(
            select(Alert)
            .where(Alert.user_id == session.user_id)
            .order_by(Alert.created_at.desc(), Alert.id.desc())
            .limit(limit)
        )
    ).scalars()
    unread = (
        await db.execute(
            select(func.count())
            .select_from(Alert)
            .where(Alert.user_id == session.user_id, Alert.read.is_(False))
        )
    ).scalar_one()
    return {
        "unread": unread,
        "alerts": [
            {
                "id": a.id,
                "rule_id": a.rule_id,
                "title": a.title,
                "body": a.body,
                "link": a.link,
                "lat": a.lat,
                "lon": a.lon,
                "severity": a.severity,
                "created_at": a.created_at.isoformat(),
                "read": a.read,
                "pushed": a.pushed,
            }
            for a in rows
        ],
    }


@router.post("/api/alerts/read", status_code=204)
async def mark_read(body: ReadIn, db: DbDep, session: UserSession = UseDep):
    q = update(Alert).where(Alert.user_id == session.user_id)
    if not body.all:
        if not body.ids:
            return
        q = q.where(Alert.id.in_(body.ids))
    await db.execute(q.values(read=True))
    await db.commit()
