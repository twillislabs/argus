"""Live updates: NATS subscriber in the API, fanned out over WebSockets."""

import asyncio
import contextlib
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("argus.live")

SUBJECT = "argus.events"
AIR_SUBJECT = "argus.air"


class Hub:
    """Connected browsers. Messages are JSON text, sent as-is."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def broadcast(self, text: str) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001 - drop broken sockets
                self.clients.discard(ws)


async def subscribe_forever(url: str, hub: Hub, air=None) -> None:
    """Keep NATS subscriptions alive, retrying while the bus is down.

    Event changes are forwarded to browsers as-is. Aircraft snapshots
    also update the API's LiveAir picture, when one is given.
    """
    import nats

    while True:
        nc = None
        try:
            nc = await nats.connect(
                url,
                name="argus-api",
                connect_timeout=3,
                max_reconnect_attempts=-1,
            )

            async def handler(msg) -> None:
                await hub.broadcast(msg.data.decode("utf-8"))

            async def air_handler(msg) -> None:
                text = msg.data.decode("utf-8")
                if air is not None:
                    try:
                        air.apply(json.loads(text).get("aircraft", []))
                    except (ValueError, KeyError, TypeError) as exc:
                        log.warning("Bad aircraft message: {0}".format(exc))
                        return
                await hub.broadcast(text)

            await nc.subscribe(SUBJECT, cb=handler)
            await nc.subscribe(AIR_SUBJECT, cb=air_handler)
            log.info("Subscribed to argus.* on {0}".format(url))
            while nc.is_connected or nc.is_reconnecting:
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            if nc is not None:
                with contextlib.suppress(Exception):
                    await nc.close()
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("NATS unavailable ({0}); retrying".format(exc))
        await asyncio.sleep(5)
