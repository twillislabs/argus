import time

import httpx
from google.transit import gtfs_realtime_pb2

from argus import transit


def feed(*vehicles, header_ts=None) -> bytes:
    msg = gtfs_realtime_pb2.FeedMessage()
    msg.header.gtfs_realtime_version = "2.0"
    msg.header.timestamp = header_ts or int(time.time())
    for i, (vid, lat, lon, extra) in enumerate(vehicles):
        e = msg.entity.add()
        e.id = str(i)
        v = e.vehicle
        v.vehicle.id = vid
        v.position.latitude = lat
        v.position.longitude = lon
        if "route" in extra:
            v.trip.route_id = extra["route"]
        if "bearing" in extra:
            v.position.bearing = extra["bearing"]
        if "ts" in extra:
            v.timestamp = extra["ts"]
    return msg.SerializeToString()


def test_parse_feed():
    now = time.time()
    data = feed(
        ("1851", 42.35, -71.11, {"route": "CR-Worcester", "bearing": 90}),
        ("1851", 42.35, -71.11, {}),  # listed twice
        ("old", 42.3, -71.1, {"ts": int(now) - 3600}),
        ("nowhere", 0, 0, {}),
    )
    out = transit.parse_feed(data, "mbta", now)
    assert [v["id"] for v in out] == ["mbta:1851"]
    assert out[0]["route"] == "CR-Worcester" and out[0]["bearing"] == 90


async def test_in_view_fetches_only_overlapping_feeds():
    asked = []

    def handler(request):
        asked.append(request.url.host)
        if "mbta" in request.url.host:
            return httpx.Response(
                200, content=feed(("1", 42.36, -71.06, {"route": "Red"}))
            )
        return httpx.Response(503)

    t = transit.Transit("test")
    t.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    boston = (-71.2, 42.2, -70.9, 42.5)
    r = await t.in_view(*boston)
    assert asked == ["cdn.mbta.com"]
    assert [v["id"] for v in r["vehicles"]] == ["mbta:1"]
    assert r["operators"][0]["licence"].startswith("MassDOT")
    await t.in_view(*boston)
    assert len(asked) == 1  # at most every MIN_AGE_S
    # Somewhere with no feed asks nobody.
    await t.in_view(0, 0, 1, 1)
    assert len(asked) == 1


async def test_transit_api_zoom(admin_client):
    r = await admin_client.get(
        "/api/transit", params={"bbox": "-80,30,-60,50"}
    )
    assert r.json()["status"] == "zoom"
