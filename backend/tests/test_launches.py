import json
from pathlib import Path

from argus import launches
from argus.models import ServerSetting

DOC = json.loads(
    (Path(__file__).parent / "fixtures" / "launches.json").read_text()
)


def test_parse_real_answer():
    items = launches.parse(DOC)
    assert len(items) == 3
    first = items[0]
    assert first["name"] == "Long March 2D | Shijian 24"
    assert first["status"] == "Success"
    assert first["country"] == "China" and first["orbit"] == "SSO"
    assert -90 <= first["lat"] <= 90 and first["pad"]


def test_links_beyond_wikipedia():
    r = {
        "slug": "falcon-9-starlink-12-3",
        "mission": {
            "vid_urls": [
                {"priority": 1, "publisher": "SpaceX",
                 "url": "https://www.youtube.com/watch?v=abc"},
                {"priority": 2, "url": "http://insecure.example/live"},
            ],
            "info_urls": [
                {"source": "spacex.com", "url": "https://www.spacex.com/l"}
            ],
        },
        "pad": {
            "name": "SLC-40",
            "info_url": "https://www.spaceforce.mil/slc40",
            "wiki_url": "https://en.wikipedia.org/wiki/SLC-40",
        },
    }  # fmt: skip
    got = [(x["kind"], x["label"]) for x in launches.links(r)]
    assert got == [
        ("webcast", "Webcast: SpaceX"),
        ("info", "spacex.com"),
        ("tracker", "Space Launch Now"),
        ("pad", "SLC-40 (pad)"),
        ("wiki", "SLC-40 (Wikipedia)"),
    ]


def test_parse_skips_unplaced():
    doc = {"results": [{"id": "x", "name": "No pad"}, {"pad": {}}]}
    assert launches.parse(doc) == []


async def test_launches_endpoint(admin_client, app):
    db = app.state.db
    async with db.sessionmaker() as session:
        session.add(
            ServerSetting(
                key="layer:launches",
                value={
                    "fetched": "2026-11-19T00:00:00",
                    "items": [{"id": "a"}],
                },
            )
        )
        await session.commit()
    body = (await admin_client.get("/api/launches")).json()
    assert (
        body["items"] == [{"id": "a"}] and "Space Devs" in body["attribution"]
    )
