"""Collector worker: polls sources, fuses events, publishes changes.

Run with `python -m argus.worker`. One process runs every enabled
collector on its own interval. Changed events are published to NATS
(subject argus.events) so the API can push them to browsers.
"""

import asyncio
import json
import logging
from datetime import timedelta

import httpx
from sqlalchemy import select

from argus import __version__
from argus.aviation import ADSB_LOL, normalise
from argus.collectors import REGISTRY, Collector
from argus.config import Settings, get_settings
from argus.db import Database, utcnow
from argus.events import event_dict
from argus.fusion import expire_and_prune, fuse, store_raw
from argus.main import configure_logging
from argus.models import Event, Source

log = logging.getLogger("argus.worker")

SUBJECT = "argus.events"
AIR_SUBJECT = "argus.air"
AIR_SOURCE = "adsb_mil"
TICK_S = 5
HOUSEKEEPING_S = 3600
RETRY_S = 300


class Publisher:
    """NATS publisher that reconnects in the background and never blocks
    collection when the bus is down."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.nc = None

    async def ensure(self) -> None:
        if not self.url or (self.nc is not None and self.nc.is_connected):
            return
        try:
            import nats

            self.nc = await nats.connect(
                self.url,
                name="argus-worker",
                connect_timeout=3,
                max_reconnect_attempts=-1,
            )
            log.info("Connected to NATS at {0}".format(self.url))
        except Exception as exc:  # noqa: BLE001 - keep collecting
            self.nc = None
            log.warning("NATS unavailable ({0}); will retry".format(exc))

    async def publish(self, message: dict, subject: str = SUBJECT) -> None:
        await self.ensure()
        if self.nc is None:
            return
        try:
            await self.nc.publish(
                subject, json.dumps(message, default=str).encode("utf-8")
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("NATS publish failed: {0}".format(exc))

    async def close(self) -> None:
        if self.nc is not None:
            await self.nc.drain()


async def register_sources(db: Database, collectors: list[Collector]) -> None:
    async with db.sessionmaker() as session:
        for c in collectors:
            row = await session.get(Source, c.name)
            if row is None:
                row = Source(name=c.name, last_count=0)
                session.add(row)
            row.label = c.label
            row.interval_s = c.interval_s
            row.enabled = c.enabled()
            if not row.enabled and c.name == "firms":
                row.last_error = "Set ARGUS_FIRMS_MAP_KEY to enable."
        await session.commit()


async def poll_military(
    client: httpx.AsyncClient, publisher: Publisher
) -> int:
    """One adsb.lol /v2/mil poll, published as a full snapshot."""
    response = await client.get("{0}mil".format(ADSB_LOL))
    response.raise_for_status()
    snapshot = [
        a
        for a in (
            normalise(x, military=True) for x in response.json().get("ac", [])
        )
        if a is not None
    ]
    await publisher.publish(
        {"type": "aircraft", "aircraft": snapshot}, AIR_SUBJECT
    )
    return len(snapshot)


async def air_loop(
    db: Database,
    settings: Settings,
    client: httpx.AsyncClient,
    publisher: Publisher,
) -> None:
    """Poll military aircraft forever, recording health in sources."""
    async with db.sessionmaker() as session:
        row = await session.get(Source, AIR_SOURCE)
        if row is None:
            row = Source(name=AIR_SOURCE, last_count=0)
            session.add(row)
        row.label = "adsb.lol military aircraft"
        row.interval_s = settings.air_interval_s
        row.enabled = True
        await session.commit()
    last_saved = None
    while True:
        started = utcnow()
        error, count = None, 0
        try:
            count = await poll_military(client, publisher)
        except Exception as exc:  # noqa: BLE001 - keep polling
            error = "{0}: {1}".format(type(exc).__name__, str(exc)[:400])
            log.warning("adsb.lol military poll failed: {0}".format(error))
        # Health is written at most once a minute, or at once on errors.
        if (
            error
            or last_saved is None
            or (started - last_saved) >= timedelta(seconds=60)
        ):
            async with db.sessionmaker() as session:
                row = await session.get(Source, AIR_SOURCE)
                row.last_run_at = started
                if error:
                    row.last_error = error
                else:
                    row.last_success_at = utcnow()
                    row.last_count = count
                    row.last_error = None
                await session.commit()
            last_saved = started
        await asyncio.sleep(
            settings.air_interval_s if not error else RETRY_S / 5
        )


async def run_collector(
    db: Database,
    collector: Collector,
    client: httpx.AsyncClient,
    publisher: Publisher,
) -> bool:
    """Run one collection. Returns True on success."""
    started = utcnow()
    async with db.sessionmaker() as session:
        source = await session.get(Source, collector.name)
        cursor = source.cursor if source else None
        try:
            result = await collector.collect(client, cursor)
            rows = await store_raw(session, result.records)
            changed = await fuse(session, rows)
            source = await session.get(Source, collector.name)
            source.last_run_at = started
            source.last_success_at = utcnow()
            source.last_count = len(result.records)
            source.last_error = (
                "Failed: {0}".format(", ".join(result.failures))
                if result.failures
                else None
            )
            if result.cursor:
                source.cursor = result.cursor
            await session.commit()
        except Exception as exc:  # noqa: BLE001 - record and carry on
            await session.rollback()
            log.exception("{0} failed".format(collector.name))
            source = await session.get(Source, collector.name)
            if source is not None:
                source.last_run_at = started
                source.last_error = "{0}: {1}".format(
                    type(exc).__name__, str(exc)[:400]
                )
                await session.commit()
            return False
        if changed:
            events = (
                await session.execute(
                    select(Event).where(Event.id.in_(list(changed)))
                )
            ).scalars()
            payload = [event_dict(e) for e in events]
            await publisher.publish({"type": "events", "events": payload})
    log.info(
        "{0}: {1} records, {2} new/updated, {3} events changed".format(
            collector.name, len(result.records), len(rows), len(changed)
        )
    )
    return True


async def run(settings: Settings) -> None:
    configure_logging(settings.log_level)
    names = [n.strip() for n in settings.collectors.split(",") if n.strip()]
    unknown = [n for n in names if n not in REGISTRY]
    if unknown:
        log.warning("Unknown collectors ignored: {0}".format(unknown))
    collectors = [REGISTRY[n](settings) for n in names if n in REGISTRY]
    db = Database(settings.database_url)
    await register_sources(db, collectors)
    active = [c for c in collectors if c.enabled()]
    log.info(
        "Argus worker {0}: {1}".format(
            __version__, ", ".join(c.name for c in active) or "no collectors"
        )
    )
    publisher = Publisher(settings.nats_url)
    next_run = {c.name: utcnow() for c in active}
    next_housekeeping = utcnow()
    running: dict[str, asyncio.Task] = {}
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={"User-Agent": settings.user_agent},
        follow_redirects=True,
    ) as client:
        air_task = None
        if settings.air_enabled:
            air_task = asyncio.create_task(
                air_loop(db, settings, client, publisher)
            )
        try:
            while True:
                now = utcnow()
                for c in active:
                    task = running.get(c.name)
                    if task is not None and not task.done():
                        continue
                    if task is not None:
                        ok = task.result()
                        delay = (
                            c.interval_s if ok else min(c.interval_s, RETRY_S)
                        )
                        next_run[c.name] = now + timedelta(seconds=delay)
                        running.pop(c.name)
                        continue
                    if now >= next_run[c.name]:
                        running[c.name] = asyncio.create_task(
                            run_collector(db, c, client, publisher)
                        )
                if now >= next_housekeeping:
                    async with db.sessionmaker() as session:
                        n = await expire_and_prune(
                            session,
                            settings.raw_retention_days,
                            settings.event_retention_days,
                        )
                        await session.commit()
                    if n:
                        log.info("Expired {0} stale events".format(n))
                    next_housekeeping = now + timedelta(seconds=HOUSEKEEPING_S)
                await asyncio.sleep(TICK_S)
        finally:
            if air_task is not None:
                air_task.cancel()
            await publisher.close()
            await db.dispose()


def main() -> None:
    asyncio.run(run(get_settings()))


if __name__ == "__main__":
    main()
