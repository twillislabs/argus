"""Collector worker: polls sources, fuses events, publishes changes.

Run with `python -m argus.worker`. One process runs every enabled
collector on its own interval. Changed events are published to NATS
(subject argus.events) so the API can push them to browsers.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select

from argus import (
    __version__,
    advisories,
    cyber,
    launches,
    sea,
    secrets,
    space,
    tension,
    wikipedia,
)
from argus import cams as traffic_cams
from argus.alpr import Alpr
from argus.aviation import (
    GPS_HOTSPOTS,
    POLL_ORDER,
    SWEEP_RADIUS_NM,
    FeedClient,
    RateLimited,
    aircraft_list,
    gps_sample,
    normalise,
)
from argus.collectors import REGISTRY, Collector
from argus.config import Settings, get_settings
from argus.db import Database, utcnow
from argus.events import event_dict
from argus.fusion import expire_and_prune, fuse, store_raw
from argus.geo import simplify
from argus.main import configure_logging
from argus.models import Event, NwsZone, RawRecord, ServerSetting, Source

log = logging.getLogger("argus.worker")

SUBJECT = "argus.events"
AIR_SUBJECT = "argus.air"
AIR_SOURCE = "adsb_mil"
GPS_SUBJECT = "argus.gps"
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


async def poll_military(feeds: FeedClient, publisher: Publisher) -> int:
    """One military poll, published as a full snapshot."""
    feed, response = await feeds.get("mil")
    snapshot = [
        a
        for a in (
            normalise(x, military=True, source=feed.name)
            for x in aircraft_list(response.json())
        )
        if a is not None
    ]
    await publisher.publish(
        {"type": "aircraft", "aircraft": snapshot}, AIR_SUBJECT
    )
    return len(snapshot)


async def sweep_gps(
    feeds: FeedClient, publisher: Publisher, index: int
) -> int:
    """One GPS hotspot from adsb.fi (never adsb.lol: its daily quota is
    for map views), published for the API's GPS grid only. Returns how
    many aircraft were seen; a paused or failing feed just skips it."""
    _, lat, lon = GPS_HOTSPOTS[index % len(GPS_HOTSPOTS)]
    try:
        feed, response = await feeds.get(
            "point", lat, lon, SWEEP_RADIUS_NM, only="adsb.fi"
        )
    except (RateLimited, httpx.HTTPError) as exc:
        log.info("GPS sweep skipped: {0}".format(type(exc).__name__))
        return 0
    sample = gps_sample(
        [
            a
            for a in (
                normalise(x, source=feed.name)
                for x in aircraft_list(response.json())
            )
            if a is not None
        ]
    )
    await publisher.publish({"aircraft": sample}, GPS_SUBJECT)
    return len(sample)


async def air_loop(
    db: Database,
    settings: Settings,
    client: httpx.AsyncClient,
    publisher: Publisher,
) -> None:
    """Poll military aircraft forever, recording health in sources."""
    feeds = FeedClient(client, POLL_ORDER)
    async with db.sessionmaker() as session:
        row = await session.get(Source, AIR_SOURCE)
        if row is None:
            row = Source(name=AIR_SOURCE, last_count=0)
            session.add(row)
        row.label = "Military aircraft (adsb.fi, adsb.lol)"
        row.interval_s = settings.air_interval_s
        row.enabled = True
        await session.commit()
    last_saved = None
    sweep = 0
    while True:
        started = utcnow()
        error, count = None, 0
        try:
            count = await poll_military(feeds, publisher)
        except Exception as exc:  # noqa: BLE001 - keep polling
            error = "{0}: {1}".format(type(exc).__name__, str(exc)[:400])
            log.warning("military poll failed: {0}".format(error))
        if settings.gps_sweep:
            # Same FeedClient, so adsb.fi stays at one request a second.
            try:
                await sweep_gps(feeds, publisher, sweep)
            except Exception as exc:  # noqa: BLE001 - keep polling
                log.warning("GPS sweep failed: {0}".format(exc))
            sweep += 1
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


SEA_SUBJECT = "argus.sea"
SEA_SOURCE = "aisstream"
SEA_FLUSH_S = 5
SEA_BATCH = 300
SEA_RETRY_S = 30
NO_KEY = "Add an AISStream API key in Settings > Data sources."


async def read_key(db: Database, settings: Settings, name: str) -> str | None:
    """An API key an admin saved in Settings > Data sources."""
    async with db.sessionmaker() as session:
        row = await session.get(ServerSetting, "keys")
        token = (row.value or {}).get(name) if row else None
    return secrets.decrypt(settings.secret_key, token) if token else None


async def _sea_health(
    db: Database, error: str | None, count: int | None = None
) -> None:
    async with db.sessionmaker() as session:
        row = await session.get(Source, SEA_SOURCE)
        if row is None:
            row = Source(name=SEA_SOURCE, last_count=0, interval_s=60)
            session.add(row)
        row.label = "AISStream vessels"
        row.enabled = error != NO_KEY
        row.last_run_at = utcnow()
        row.last_error = error
        if error is None:
            row.last_success_at = utcnow()
            if count is not None:
                row.last_count = count
        await session.commit()


async def sea_loop(
    db: Database, settings: Settings, publisher: Publisher
) -> None:
    """Stream AIS from AISStream and publish vessel changes on NATS.

    Waits for an admin to add a key; reconnects with a pause on errors or
    when the key changes.
    """
    from websockets.asyncio.client import connect

    while True:
        key = await read_key(db, settings, "aisstream")
        if not key:
            await _sea_health(db, NO_KEY)
            await asyncio.sleep(60)
            continue
        pending: dict[int, dict] = {}
        received = 0
        try:
            async with connect(
                sea.AISSTREAM_URL,
                # AISStream's handshake can take 15 s or more.
                open_timeout=60,
                ping_interval=20,
                max_size=2**20,
            ) as ws:
                await ws.send(
                    json.dumps(
                        {
                            "APIKey": key,
                            "BoundingBoxes": [[[-90, -180], [90, 180]]],
                            "FilterMessageTypes": sea.MESSAGE_TYPES,
                        }
                    )
                )
                log.info("Connected to AISStream")
                last_flush = last_health = time.monotonic()
                async for raw in ws:
                    msg = json.loads(raw)
                    if isinstance(msg, dict) and msg.get("error"):
                        raise RuntimeError(
                            "AISStream: {0}".format(msg["error"])
                        )
                    update = sea.parse(msg) if isinstance(msg, dict) else None
                    if update:
                        merged = pending.setdefault(update["mmsi"], {})
                        merged.update(update)
                        received += 1
                    now = time.monotonic()
                    if now - last_flush >= SEA_FLUSH_S and pending:
                        batch = list(pending.values())
                        pending.clear()
                        for i in range(0, len(batch), SEA_BATCH):
                            await publisher.publish(
                                {
                                    "type": "vessels",
                                    "vessels": batch[i : i + SEA_BATCH],
                                },
                                SEA_SUBJECT,
                            )
                        last_flush = now
                    if now - last_health >= 60:
                        await _sea_health(db, None, received)
                        received = 0
                        last_health = now
                        if await read_key(db, settings, "aisstream") != key:
                            log.info("AISStream key changed; reconnecting")
                            break
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - reconnect after a pause
            message = "{0}: {1}".format(type(exc).__name__, str(exc)[:300])
            log.warning("AISStream stream ended: {0}".format(message))
            await _sea_health(db, message)
            await asyncio.sleep(SEA_RETRY_S)


CABLES = {
    "cables": "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json",
    "landings": (
        "https://www.submarinecablemap.com/api/v3/landing-point/"
        "landing-point-geo.json"
    ),
}
CABLES_EVERY = timedelta(days=30)


async def cables_loop(db: Database, client: httpx.AsyncClient) -> None:
    """TeleGeography's submarine cable map, monthly. It's CC BY-NC-SA, so
    it's fetched onto this server and kept in the database, never
    bundled with Argus."""
    while True:
        async with db.sessionmaker() as session:
            row = await session.get(ServerSetting, "layer:cables")
            fetched = (row.value or {}).get("fetched") if row else None
            due = (
                fetched is None
                or utcnow() - datetime.fromisoformat(fetched) >= CABLES_EVERY
            )
            source = await session.get(Source, "cables")
            if source is None:
                source = Source(
                    name="cables",
                    label="TeleGeography submarine cables",
                    interval_s=int(CABLES_EVERY.total_seconds()),
                    enabled=True,
                    last_count=0,
                )
                session.add(source)
            if due:
                source.last_run_at = utcnow()
                try:
                    value = {"fetched": utcnow().isoformat()}
                    for name, url in CABLES.items():
                        response = await client.get(url)
                        response.raise_for_status()
                        value[name] = response.json()
                    if row is None:
                        row = ServerSetting(key="layer:cables")
                        session.add(row)
                    row.value = value
                    row.updated_at = utcnow()
                    source.last_success_at = utcnow()
                    source.last_count = len(
                        value["cables"].get("features", [])
                    )
                    source.last_error = None
                    log.info("cables: {0}".format(source.last_count))
                except (httpx.HTTPError, ValueError) as exc:
                    source.last_error = "{0}: {1}".format(
                        type(exc).__name__, str(exc)[:300]
                    )
            await session.commit()
        await asyncio.sleep(6 * 3600)


ADVISORIES_EVERY = timedelta(hours=6)


async def advisories_loop(db: Database, client: httpx.AsyncClient) -> None:
    """US and UK travel advisories every six hours, kept in
    server_settings["layer:advisories"] (argus/advisories.py)."""
    while True:
        async with db.sessionmaker() as session:
            row = await session.get(ServerSetting, "layer:advisories")
            previous = dict(row.value or {}) if row else {}
            fetched = previous.get("fetched")
            due = (
                fetched is None
                or utcnow() - datetime.fromisoformat(fetched)
                >= ADVISORIES_EVERY
            )
            source = await session.get(Source, "advisories")
            if source is None:
                source = Source(
                    name="advisories",
                    label="Travel advisories (US State Dept, UK FCDO)",
                    interval_s=int(ADVISORIES_EVERY.total_seconds()),
                    enabled=True,
                    last_count=0,
                )
                session.add(source)
            await session.commit()
        if due:
            started = utcnow()
            error, value = None, None
            try:
                value = await advisories.fetch(client, previous)
            except (httpx.HTTPError, ValueError) as exc:
                error = "{0}: {1}".format(type(exc).__name__, str(exc)[:300])
            async with db.sessionmaker() as session:
                source = await session.get(Source, "advisories")
                source.last_run_at = started
                if value is not None:
                    row = await session.get(ServerSetting, "layer:advisories")
                    if row is None:
                        row = ServerSetting(key="layer:advisories")
                        session.add(row)
                    row.value = {"fetched": utcnow().isoformat(), **value}
                    row.updated_at = utcnow()
                    source.last_success_at = utcnow()
                    source.last_count = len(advisories.merged(value))
                    source.last_error = None
                    log.info("advisories: {0}".format(source.last_count))
                else:
                    source.last_error = error
                    log.warning("advisories failed: {0}".format(error))
                await session.commit()
        await asyncio.sleep(1800)


WIKIPEDIA_EVERY = timedelta(hours=1)
LAUNCHES_EVERY = timedelta(hours=2)
CYBER_EVERY = timedelta(minutes=30)
KEV_EVERY = timedelta(hours=6)


async def cyber_loop(db: Database, client: httpx.AsyncClient) -> None:
    """Internet outages and ransomware victims every half hour, CISA's
    exploited vulnerabilities every six hours, into server_settings
    ["layer:cyber"] (argus/cyber.py). Each part keeps its last good
    answer when its source fails."""
    while True:
        async with db.sessionmaker() as session:
            source = await session.get(Source, "cyber")
            if source is None:
                source = Source(
                    name="cyber",
                    label="Cyber (IODA, ransomware.live, CISA KEV)",
                    interval_s=int(CYBER_EVERY.total_seconds()),
                    enabled=True,
                    last_count=0,
                )
                session.add(source)
            row = await session.get(ServerSetting, "layer:cyber")
            value = dict(row.value) if row else {}
            await session.commit()
        started = utcnow()
        errors = []
        parts = [
            ("outages", cyber.fetch_outages),
            ("ransomware", cyber.fetch_ransomware),
        ]
        kev_at = value.get("kev_fetched")
        if (
            not kev_at
            or utcnow() - datetime.fromisoformat(kev_at) >= KEV_EVERY
        ):
            parts.append(("kev", cyber.fetch_kev))
        for key, fetch in parts:
            try:
                value[key] = await fetch(client)
                value[key + "_fetched"] = utcnow().isoformat()
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                errors.append(
                    "{0}: {1}: {2}".format(
                        key, type(exc).__name__, str(exc)[:200]
                    )
                )
        async with db.sessionmaker() as session:
            source = await session.get(Source, "cyber")
            source.last_run_at = started
            row = await session.get(ServerSetting, "layer:cyber")
            if row is None:
                row = ServerSetting(key="layer:cyber")
                session.add(row)
            row.value = value
            row.updated_at = utcnow()
            if len(errors) < len(parts):
                source.last_success_at = utcnow()
            source.last_count = len(value.get("outages") or []) + len(
                value.get("ransomware") or []
            )
            source.last_error = "; ".join(errors) or None
            await session.commit()
        if errors:
            log.warning("cyber: {0}".format("; ".join(errors)))
        else:
            log.info(
                "cyber: {0} outages, {1} ransomware countries".format(
                    len(value.get("outages") or []),
                    len(value.get("ransomware") or []),
                )
            )
        await asyncio.sleep(CYBER_EVERY.total_seconds())


async def launches_loop(db: Database, client: httpx.AsyncClient) -> None:
    """Rocket launches every two hours into server_settings
    ["layer:launches"] (argus/launches.py). Launch Library allows 15
    requests an hour, so the last success is honoured across restarts.
    """
    while True:
        async with db.sessionmaker() as session:
            source = await session.get(Source, "launches")
            if source is None:
                source = Source(
                    name="launches",
                    label="Rocket launches (Launch Library 2)",
                    interval_s=int(LAUNCHES_EVERY.total_seconds()),
                    enabled=True,
                    last_count=0,
                )
                session.add(source)
            last = source.last_success_at
            await session.commit()
        if last is not None and utcnow() - last < LAUNCHES_EVERY:
            wait = LAUNCHES_EVERY - (utcnow() - last)
            await asyncio.sleep(max(60.0, wait.total_seconds()))
            continue
        started = utcnow()
        error, items = None, None
        try:
            items = await launches.fetch(client)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            error = "{0}: {1}".format(type(exc).__name__, str(exc)[:300])
        async with db.sessionmaker() as session:
            source = await session.get(Source, "launches")
            source.last_run_at = started
            if items is not None:
                row = await session.get(ServerSetting, "layer:launches")
                if row is None:
                    row = ServerSetting(key="layer:launches")
                    session.add(row)
                row.value = {"fetched": utcnow().isoformat(), "items": items}
                row.updated_at = utcnow()
                source.last_success_at = utcnow()
                source.last_count = len(items)
                source.last_error = None
                log.info("launches: {0}".format(len(items)))
            else:
                source.last_error = error
                log.warning("launches failed: {0}".format(error))
            await session.commit()
        if items is None:
            # Rate limited or down: try again in half an hour.
            await asyncio.sleep(1800)


async def wikipedia_loop(db: Database, client: httpx.AsyncClient) -> None:
    """Wikipedia's Current events portal (the last few days) every hour,
    kept in server_settings["layer:wikipedia"] (argus/wikipedia.py)."""
    while True:
        async with db.sessionmaker() as session:
            source = await session.get(Source, "wikipedia")
            if source is None:
                source = Source(
                    name="wikipedia",
                    label="Wikipedia current events",
                    interval_s=int(WIKIPEDIA_EVERY.total_seconds()),
                    enabled=True,
                    last_count=0,
                )
                session.add(source)
            await session.commit()
        started = utcnow()
        error, items = None, None
        try:
            items = await wikipedia.fetch(client, started.date())
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            error = "{0}: {1}".format(type(exc).__name__, str(exc)[:300])
        async with db.sessionmaker() as session:
            source = await session.get(Source, "wikipedia")
            source.last_run_at = started
            if items is not None:
                row = await session.get(ServerSetting, "layer:wikipedia")
                if row is None:
                    row = ServerSetting(key="layer:wikipedia")
                    session.add(row)
                row.value = {"fetched": utcnow().isoformat(), "items": items}
                row.updated_at = utcnow()
                source.last_success_at = utcnow()
                source.last_count = len(items)
                source.last_error = None
                log.info("wikipedia: {0} entries".format(len(items)))
            else:
                source.last_error = error
                log.warning("wikipedia failed: {0}".format(error))
            await session.commit()
        await asyncio.sleep(WIKIPEDIA_EVERY.total_seconds())


CAMS_EVERY = timedelta(days=1)


async def save_cams(
    db: Database,
    feeds: dict,
    tdot_key: str | None,
    started: datetime,
    errors: list[str],
    fetched: str | None = None,
) -> int:
    """Store the camera catalogue. A pass part-way through keeps the old
    fetched time (pass fetched=), so only a finished pass counts."""
    count = sum(len(v) for v in feeds.values())
    async with db.sessionmaker() as session:
        row = await session.get(ServerSetting, "layer:trafficcams")
        if row is None:
            row = ServerSetting(key="layer:trafficcams")
            session.add(row)
        row.value = {
            "fetched": fetched
            if fetched is not None
            else utcnow().isoformat(),
            "tdot_key": bool(tdot_key),
            "feeds": feeds,
        }
        row.updated_at = utcnow()
        source = await session.get(Source, "trafficcams")
        source.last_run_at = started
        source.last_count = count
        if count:
            source.last_success_at = utcnow()
        source.last_error = "; ".join(errors) or None
        await session.commit()
    return count


async def cams_pass(
    db: Database, settings: Settings, client: httpx.AsyncClient
) -> None:
    """One check of the traffic camera catalogues (see cams_loop)."""
    async with db.sessionmaker() as session:
        row = await session.get(ServerSetting, "layer:trafficcams")
        previous = dict(row.value or {}) if row else {}
        source = await session.get(Source, "trafficcams")
        label = "Traffic cameras (Caltrans, DriveBC, TfL, Digitraffic, TDOT)"
        if source is not None:
            source.label = label
        if source is None:
            source = Source(
                name="trafficcams",
                label=label,
                interval_s=int(CAMS_EVERY.total_seconds()),
                enabled=True,
                last_count=0,
            )
            session.add(source)
        await session.commit()
    fetched = previous.get("fetched")
    tdot_key = await read_key(db, settings, "tdot")
    key_changed = bool(tdot_key) != bool(previous.get("tdot_key"))
    due = (
        fetched is None
        or key_changed
        or utcnow() - datetime.fromisoformat(fetched) >= CAMS_EVERY
    )
    if due:
        started = utcnow()
        feeds = dict(previous.get("feeds") or {})
        errors = []
        # TDOT first (the one with a key); then the open feeds.
        # Each fails on its own and keeps its last cameras; nothing
        # here may end the loop.
        jobs = []
        if tdot_key:
            jobs.append(
                (
                    "tdot",
                    lambda k=tdot_key: traffic_cams.fetch_tdot(client, k),
                )
            )
        else:
            feeds.pop("tdot", None)
        jobs.append(("caltrans", lambda: traffic_cams.fetch_caltrans(client)))
        for name, fetch in traffic_cams.OPEN_FEEDS.items():
            jobs.append((name, lambda f=fetch: f(client)))

        for name, job in jobs:
            try:
                feeds[name] = await job()
                log.info(
                    "traffic cameras, {0}: {1}".format(name, len(feeds[name]))
                )
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                log.warning(
                    "traffic cameras, {0} failed: {1}".format(name, exc)
                )
                errors.append("{0}: {1}".format(name, str(exc)[:200]))
            # Saved after each feed, so one slow feed doesn't hold the
            # others back.
            count = await save_cams(
                db, feeds, tdot_key, started, errors, fetched
            )
        count = await save_cams(db, feeds, tdot_key, started, errors)
        log.info("traffic cameras: {0}".format(count))


async def cams_loop(
    db: Database, settings: Settings, client: httpx.AsyncClient
) -> None:
    """Traffic camera catalogues daily (argus/cams.py), kept in
    server_settings["layer:trafficcams"]. Each feed fails on its own;
    a feed that fails keeps its last cameras. Checked every ten minutes
    (a new or removed TDOT key starts a pass at once)."""
    while True:
        try:
            await cams_pass(db, settings, client)
        except Exception:  # noqa: BLE001 - keep checking
            log.exception("traffic cameras pass failed")
        await asyncio.sleep(600)


ALPR_PREFETCH_EVERY_S = 6 * 3600
ALPR_PREFETCH_MAX = 60  # tiles a pass


async def _prefetch_tile(alpr: Alpr, tile: tuple[int, int]) -> None:
    # Alpr.tile itself keeps to one request per Overpass server.
    try:
        await alpr.tile(tile)
    except Exception as exc:  # noqa: BLE001 - one tile failing is fine
        log.info("ALPR prefetch {0}: {1}".format(tile, exc))


async def alpr_prefetch_loop(db: Database, settings: Settings) -> None:
    """Plate reader cameras around every saved home (and wall screen's
    home), fetched ahead into the shared tile store, so those areas load
    at once. Tiles still fresh are skipped; the rest go to Overpass one
    per server at a time, like the API's."""
    from argus.models import UserPreferences

    alpr = Alpr(settings.user_agent, db)
    try:
        while True:
            try:
                async with db.sessionmaker() as session:
                    rows = (
                        await session.execute(select(UserPreferences))
                    ).scalars()
                    homes = {
                        (round(h["lat"]), round(h["lon"]))
                        for h in ((r.data or {}).get("home") for r in rows)
                        if isinstance(h, dict) and "lat" in h and "lon" in h
                    }
                wanted = []
                for lat, lon in sorted(homes):
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            tile = (lon - 1 + dx, lat - 1 + dy)
                            if tile not in wanted:
                                wanted.append(tile)
                wanted = wanted[:ALPR_PREFETCH_MAX]
                await alpr._load(wanted)
                missing = [t for t in wanted if alpr.cached(t) is None]
                await asyncio.gather(
                    *(_prefetch_tile(alpr, t) for t in missing)
                )
                if missing:
                    log.info(
                        "ALPR prefetch: {0} tile(s) around {1} home(s)".format(
                            len(missing), len(homes)
                        )
                    )
            except Exception:  # noqa: BLE001 - try again next pass
                log.exception("ALPR prefetch failed")
            await asyncio.sleep(ALPR_PREFETCH_EVERY_S)
    finally:
        await alpr.close()


ZONE_TOLERANCE = 0.01  # degrees, about 1 km
ZONES_PER_PASS = 60
ZONE_RETRY = timedelta(days=1)


def zone_rings(geometry: dict | None) -> list[list[list[float]]]:
    """A zone's outer rings, simplified to about a kilometre."""
    if not geometry:
        return []
    kind = geometry.get("type")
    if kind == "Polygon":
        polys = [geometry["coordinates"]]
    elif kind == "MultiPolygon":
        polys = geometry["coordinates"]
    else:
        return []
    out = []
    for poly in polys:
        ring = [[float(x), float(y)] for x, y, *_ in poly[0]]
        ring = simplify(ring, ZONE_TOLERANCE)
        if len(ring) >= 4:
            out.append([[round(x, 3), round(y, 3)] for x, y in ring])
    return out


async def zones_once(db: Database, client: httpx.AsyncClient) -> int:
    """Fetch outlines for zones that current NWS alerts name and Argus
    doesn't have yet (or that failed over a day ago). Polite: one request
    a second, at most ZONES_PER_PASS a pass."""
    async with db.sessionmaker() as session:
        rows = (
            await session.execute(
                select(RawRecord).where(
                    RawRecord.kind == "wxalert",
                    RawRecord.fetched_at >= utcnow() - timedelta(minutes=15),
                )
            )
        ).scalars()
        wanted: dict[str, str] = {}
        for r in rows:
            for url in (r.payload or {}).get("zone_urls") or []:
                wanted[url.rsplit("/", 1)[-1][:16]] = url
        if not wanted:
            return 0
        have = {
            z.id: z
            for z in (
                await session.execute(
                    select(NwsZone).where(NwsZone.id.in_(list(wanted)))
                )
            ).scalars()
        }
    todo = [
        (zid, url)
        for zid, url in wanted.items()
        if zid not in have
        or (
            not have[zid].rings
            and utcnow() - have[zid].fetched_at > ZONE_RETRY
        )
    ][:ZONES_PER_PASS]
    fetched = 0
    for zid, url in todo:
        rings: list = []
        name = ""
        try:
            response = await client.get(
                url, headers={"Accept": "application/geo+json"}
            )
            if response.status_code == 200:
                body = response.json()
                rings = zone_rings(body.get("geometry"))
                name = str((body.get("properties") or {}).get("name") or "")
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("zone {0}: {1}".format(zid, exc))
        async with db.sessionmaker() as session:
            row = await session.get(NwsZone, zid)
            if row is None:
                row = NwsZone(id=zid)
                session.add(row)
            row.name = name[:120]
            row.rings = rings
            row.fetched_at = utcnow()
            await session.commit()
        fetched += 1
        await asyncio.sleep(1.0)
    if fetched:
        log.info("nws zones: fetched {0}".format(fetched))
    return fetched


async def zones_loop(db: Database, client: httpx.AsyncClient) -> None:
    while True:
        try:
            await zones_once(db, client)
        except Exception:  # noqa: BLE001 - keep going next pass
            log.exception("nws zones pass failed")
        await asyncio.sleep(60)


async def tension_once(db: Database) -> bool:
    """Sample the tension index once per clock hour. The hour sampled is
    kept in server_settings, so a restart doesn't sample it twice."""
    hour = utcnow().strftime("%Y-%m-%dT%H")
    async with db.sessionmaker() as session:
        row = await session.get(ServerSetting, "tension:last")
        if row is not None and (row.value or {}).get("hour") == hour:
            return False
        backfilled = await tension.backfill(session)
        if backfilled:
            log.info("tension: backfilled {0} hours".format(backfilled))
        areas = await tension.record_sample(session)
        await tension.prune(session, utcnow().date())
        if row is None:
            row = ServerSetting(key="tension:last")
            session.add(row)
        row.value = {"hour": hour, "areas": areas}
        row.updated_at = utcnow()
        await session.commit()
    log.info("tension: sampled {0} areas".format(areas))
    return True


async def tension_loop(db: Database) -> None:
    while True:
        try:
            await tension_once(db)
        except Exception:  # noqa: BLE001 - keep sampling next hour
            log.exception("tension sample failed")
        now = utcnow()
        nxt = (now + timedelta(hours=1)).replace(
            minute=1, second=0, microsecond=0
        )
        await asyncio.sleep(max(60.0, (nxt - now).total_seconds()))


LOCAL_AIR_SUBJECT = "argus.local_air"
RECEIVER_ADSB_S = 2
RECEIVER_AIS_S = 10


async def read_receivers(db: Database) -> dict:
    async with db.sessionmaker() as session:
        row = await session.get(ServerSetting, "receivers")
        return dict(row.value) if row else {}


async def receivers_loop(
    db: Database, client: httpx.AsyncClient, publisher: Publisher
) -> None:
    """Poll your own receivers (Settings > Data sources): readsb or
    tar1090 aircraft.json, and an AIS-catcher ships.json."""
    config: dict = {}
    # None until the first pass: monotonic time can be small just after
    # boot, so comparing against 0 would skip the first check.
    checked: float | None = None
    last_ais: float | None = None
    while True:
        now = time.monotonic()
        if checked is None or now - checked > 60:
            config = await read_receivers(db)
            checked = now
        adsb, ais = config.get("adsb_url"), config.get("ais_url")
        if adsb:
            try:
                response = await client.get(adsb, timeout=5.0)
                response.raise_for_status()
                aircraft = []
                for ac in response.json().get("aircraft", []):
                    a = normalise(ac)
                    if a is not None:
                        a["source"] = "local"
                        aircraft.append(a)
                await publisher.publish(
                    {"type": "aircraft_local", "aircraft": aircraft},
                    LOCAL_AIR_SUBJECT,
                )
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("Receiver {0}: {1}".format(adsb, exc))
                await asyncio.sleep(10)
        if ais and (last_ais is None or now - last_ais >= RECEIVER_AIS_S):
            last_ais = now
            try:
                response = await client.get(ais, timeout=5.0)
                response.raise_for_status()
                ships = sea.parse_aiscatcher(response.json())
                for i in range(0, len(ships), SEA_BATCH):
                    await publisher.publish(
                        {
                            "type": "vessels",
                            "vessels": ships[i : i + SEA_BATCH],
                        },
                        SEA_SUBJECT,
                    )
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("Receiver {0}: {1}".format(ais, exc))
        await asyncio.sleep(RECEIVER_ADSB_S if adsb else 30)


SPACE_SOURCE = "celestrak"
SPACE_BLOCKED_S = 2 * 3600


async def space_loop(db: Database, client: httpx.AsyncClient) -> None:
    """Refresh the satellite catalogue every six hours.

    The last success is kept in sources, so restarting the worker doesn't
    fetch again early (CelesTrak blocks clients that fetch too often).
    """
    async with db.sessionmaker() as session:
        row = await session.get(Source, SPACE_SOURCE)
        if row is None:
            row = Source(name=SPACE_SOURCE, last_count=0)
            session.add(row)
        row.label = "CelesTrak satellites"
        row.interval_s = int(space.REFRESH.total_seconds())
        row.enabled = True
        await session.commit()
    while True:
        async with db.sessionmaker() as session:
            row = await session.get(Source, SPACE_SOURCE)
            last = row.last_success_at if row else None
            due = last is None or utcnow() - last >= space.REFRESH
            if due:
                started = utcnow()
                try:
                    count, failures = await space.refresh_catalog(
                        session, client
                    )
                    row = await session.get(Source, SPACE_SOURCE)
                    row.last_run_at = started
                    row.last_success_at = utcnow()
                    row.last_count = count
                    row.last_error = (
                        "Tag groups failed: {0}".format(", ".join(failures))
                        if failures
                        else None
                    )
                    await session.commit()
                    log.info("celestrak: {0} satellites".format(count))
                except Exception as exc:  # noqa: BLE001 - retry later
                    await session.rollback()
                    log.warning("CelesTrak refresh failed: {0}".format(exc))
                    row = await session.get(Source, SPACE_SOURCE)
                    row.last_run_at = started
                    row.last_error = "{0}: {1}".format(
                        type(exc).__name__, str(exc)[:400]
                    )
                    await session.commit()
                    # 403 means CelesTrak is blocking us for fetching too
                    # often; asking again sooner only extends the block.
                    blocked = "403" in str(exc)
                    await asyncio.sleep(
                        SPACE_BLOCKED_S if blocked else RETRY_S * 6
                    )
                    continue
                last = utcnow()
        wait = space.REFRESH - (utcnow() - last) if last else space.REFRESH
        await asyncio.sleep(max(60.0, wait.total_seconds()))


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
        space_task = None
        sea_task = None
        receivers_task = asyncio.create_task(
            receivers_loop(db, client, publisher)
        )
        cables_task = asyncio.create_task(cables_loop(db, client))
        tension_task = asyncio.create_task(tension_loop(db))
        advisories_task = asyncio.create_task(advisories_loop(db, client))
        wikipedia_task = asyncio.create_task(wikipedia_loop(db, client))
        launches_task = asyncio.create_task(launches_loop(db, client))
        cyber_task = asyncio.create_task(cyber_loop(db, client))
        cams_task = asyncio.create_task(cams_loop(db, settings, client))
        alpr_task = asyncio.create_task(alpr_prefetch_loop(db, settings))
        zones_task = (
            asyncio.create_task(zones_loop(db, client))
            if "nws" in names
            else None
        )
        if settings.sea_enabled:
            sea_task = asyncio.create_task(sea_loop(db, settings, publisher))
        if settings.space_enabled:
            space_task = asyncio.create_task(space_loop(db, client))
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
            for task in (
                air_task,
                space_task,
                sea_task,
                receivers_task,
                cables_task,
                tension_task,
                advisories_task,
                wikipedia_task,
                launches_task,
                cyber_task,
                cams_task,
                alpr_task,
                zones_task,
            ):
                if task is not None:
                    task.cancel()
            await publisher.close()
            await db.dispose()


def main() -> None:
    asyncio.run(run(get_settings()))


if __name__ == "__main__":
    main()
