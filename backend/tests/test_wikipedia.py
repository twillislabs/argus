"""Wikipedia current events. The fixture is one day of
Portal:Current_events (CC BY-SA 4.0, Wikipedia contributors)."""

import os
from datetime import date

import httpx

from argus import wikipedia

FIXTURE = os.path.join(
    os.path.dirname(__file__), "fixtures", "wikipedia_current_events.html"
)
with open(FIXTURE, encoding="utf-8") as f:
    HTML = f.read()


def test_parse_day():
    entries = wikipedia.parse_day(HTML)
    assert len(entries) == 15
    first = entries[0]
    assert first["category"] == "Armed conflicts and attacks"
    assert first["topics"][0] == "Russo-Ukrainian War"
    assert first["text"].startswith("The Crimean Bridge is struck")
    assert not first["text"].endswith(")")  # source names dropped
    assert "Crimean Bridge" in first["links"]
    assert first["sources"] and first["sources"][0]["url"].startswith("http")
    assert {"Sports", "Law and crime"} <= {e["category"] for e in entries}


def test_place_rank():
    r = wikipedia.place_rank
    assert r("country", "Country in South Asia") == wikipedia.RANK_COUNTRY
    assert r(None, "Country in South America") == wikipedia.RANK_COUNTRY
    assert r(None, "District of Bangladesh in Khulna") == (
        wikipedia.RANK_DISTRICT
    )
    assert r("adm3rd", "Upazila in Khulna Division") == wikipedia.RANK_TOWN
    assert r(None, "Place in Ouest, Haiti") == wikipedia.RANK_TOWN
    assert r(None, "Political party in Bangladesh") == wikipedia.RANK_ORG
    assert r(None, "Autonomous territory in the Middle East") == (
        wikipedia.RANK_REGION
    )
    assert r("landmark", "Bridge in Crimea") == wikipedia.RANK_LANDMARK


def test_best_place_prefers_the_most_specific():
    entry = {"links": ["Ukraine", "Crimean Bridge"], "topics": ["Russia"]}
    coords = {
        "Ukraine": (50.45, 30.5, wikipedia.RANK_COUNTRY),
        "Crimean Bridge": (45.3, 36.5, wikipedia.RANK_LANDMARK),
        "Russia": (66, 94, wikipedia.RANK_COUNTRY),
    }
    assert wikipedia.best_place(entry, coords) == (
        45.3,
        36.5,
        "Crimean Bridge",
    )
    assert wikipedia.best_place({"links": [], "topics": []}, coords) is None


async def test_fetch_places_entries():
    def handler(request):
        p = request.url.params
        if p.get("action") == "parse":
            if p["page"].endswith("November_19"):
                return httpx.Response(200, json={"error": {"code": "missing"}})
            return httpx.Response(200, json={"parse": {"text": HTML}})
        titles = p["titles"].split("|")
        pages = [
            {
                "title": "Crimean Bridge",
                "description": "Road and rail bridge",
                "coordinates": [
                    {"lat": 45.3, "lon": 36.5, "type": "landmark"}
                ],
            }
        ]
        q = {"pages": [pg for pg in pages if pg["title"] in titles]}
        return httpx.Response(200, json={"query": q})

    wikipedia.GAP_S = 0
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    ) as client:
        items = await wikipedia.fetch(client, date(2026, 11, 19))
    # Today has no page yet; the two days before do (the same fixture).
    assert len(items) == 30
    bridge = items[0]
    assert bridge["date"] == "2026-11-18"
    assert (bridge["lat"], bridge["lon"]) == (45.3, 36.5)
    assert bridge["url"].endswith("Portal:Current_events/2026_November_18")


async def test_wikipedia_api(app, admin_client):
    from argus.models import ServerSetting

    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:wikipedia",
                value={
                    "fetched": "2026-11-19T00:00:00+00:00",
                    "items": [{"id": "2026-11-18:0", "text": "x"}],
                },
            )
        )
        await db.commit()
    r = (await admin_client.get("/api/wikipedia")).json()
    assert r["items"][0]["id"] == "2026-11-18:0"
    assert "CC BY-SA" in r["attribution"]


async def test_coordinates_follow_redirects_for_every_link():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "query": {
                    "normalized": [
                        {
                            "from": "Gopalganj_District",
                            "to": "Gopalganj District",
                        }
                    ],
                    "redirects": [
                        {
                            "from": "Gopalganj District",
                            "to": "Gopalganj District, Bangladesh",
                        },
                        {
                            "from": "Gopalganj",
                            "to": "Gopalganj District, Bangladesh",
                        },
                    ],
                    "pages": [
                        {
                            "title": "Gopalganj District, Bangladesh",
                            "description": "District of Bangladesh",
                            "coordinates": [{"lat": 23.0, "lon": 89.8}],
                        }
                    ],
                }
            },
        )

    wikipedia.GAP_S = 0
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    ) as client:
        out = await wikipedia.coordinates(
            client, ["Gopalganj_District", "Gopalganj", "Nowhere"]
        )
    assert out["Gopalganj_District"] == (23.0, 89.8, wikipedia.RANK_DISTRICT)
    assert out["Gopalganj"] == out["Gopalganj_District"]
    assert "Nowhere" not in out
