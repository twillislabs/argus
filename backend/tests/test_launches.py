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
