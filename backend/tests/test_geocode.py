import json
import time
from pathlib import Path

import httpx
import pytest

from argus import geocode

DOC = json.loads(
    (Path(__file__).parent / "fixtures" / "nominatim.json").read_text()
)


def test_parse_real_answer():
    found = geocode.parse(DOC)
    assert found[0]["kind"] == "address"
    assert found[0]["label"] == "White House"
    assert "Pennsylvania Avenue" in found[0]["detail"]
    assert found[0]["height_m"] == 900
    assert geocode.parse([{"lat": "x"}, {"display_name": ""}]) == []


async def test_spaced_and_cached(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((time.monotonic(), request.url.params["q"]))
        return httpx.Response(200, json=DOC)

    g = geocode.Geocoder("test")
    g.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(geocode, "SPACING_S", 0.2)
    await g.search("1600 Pennsylvania Ave")
    await g.search("1600  pennsylvania ave")  # same, from the cache
    await g.search("10 Downing Street")
    assert [q for _, q in calls] == [
        "1600 Pennsylvania Ave",
        "10 Downing Street",
    ]
    assert calls[1][0] - calls[0][0] >= 0.19
    g.waiting = geocode.MAX_WAITING
    with pytest.raises(geocode.Busy):
        await g.search("somewhere new")
    await g.close()


async def test_endpoint_needs_sign_in(client):
    assert (await client.get("/api/geocode?q=White+House")).status_code == 401
