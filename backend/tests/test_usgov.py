from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from argus import fusion
from argus.collectors.base import RawIn
from argus.collectors.usgov import parse_fema, parse_wfigs
from argus.db import utcnow
from argus.models import Event
from tests.test_fusion import run

NOW = datetime(2026, 11, 20, 18, 0, tzinfo=UTC)


def test_fema_one_record_per_declaration():
    rows = [
        {
            "femaDeclarationString": "DR-4955-FL",
            "disasterNumber": 4955,
            "state": "FL",
            "declarationType": "DR",
            "declarationDate": "2026-10-27T00:00:00.000Z",
            "incidentType": "Hurricane",
            "declarationTitle": "HURRICANE ISAIAS",
            "designatedArea": area,
        }
        for area in ("Franklin (County)", "Leon (County)")
    ]
    (rec,) = parse_fema(rows, NOW)
    assert rec.external_id == "DR-4955-FL" and rec.kind == "hazard"
    p = rec.payload
    assert p["title"] == (
        "Major disaster declaration: Hurricane Isaias, Florida"
    )
    assert "Franklin, Leon" in p["summary"] and p["hazard"] == "cyclone"
    assert 24 < rec.lat < 31 and -88 < rec.lon < -80
    assert p["url"] == "https://www.fema.gov/disaster/4955"
    assert p["place"] == "Florida, United States"


def test_wfigs_open_fires_only():
    def fire(uid, acres, contained):
        return {
            "geometry": {"type": "Point", "coordinates": [-120.5, 38.2]},
            "properties": {
                "IncidentName": "creek",
                "IncidentSize": acres,
                "PercentContained": contained,
                "POOState": "US-CA",
                "POOCounty": "Tuolumne",
                "UniqueFireIdentifier": uid,
                "FireCause": "Natural",
                "TotalIncidentPersonnel": 250,
                "FireDiscoveryDateTime": 1794500000000,
            },
        }

    doc = {
        "features": [
            fire("a", 12000, 40),
            fire("b", 50, None),
            fire("c", 5000, 100),
        ]
    }
    (rec,) = parse_wfigs(doc, NOW)
    assert rec.payload["title"] == "Creek Fire (Tuolumne County, CA)"
    assert rec.payload["severity"] == 3
    assert "12,000 acres, 40% contained" in rec.payload["summary"]


def wx(ext, event, description="", expires=None):
    return RawIn(
        source="nws",
        external_id=ext,
        kind="wxalert",
        observed_at=utcnow(),
        lat=36.16,
        lon=-86.78,
        payload={
            "event": event,
            "headline": "{0} issued by NWS Nashville TN".format(event),
            "severity": 3,
            "area": "Davidson, TN; Williamson, TN",
            "description": description,
            "expires": (
                expires or (utcnow() + timedelta(minutes=40))
            ).isoformat(),
            "url": "https://alerts.weather.gov/search?id=x",
        },
    )


async def test_severe_nws_warnings_become_events(app):
    async with app.state.db.sessionmaker() as db:
        await run(
            db,
            [
                wx("t1", "Tornado Warning", "A confirmed large and "
                   "destructive tornado... TORNADO EMERGENCY for Nashville"),
                wx("f1", "Flash Flood Warning", "Flooding is ongoing."),
                wx("w1", "Wind Advisory"),
                wx("s1", "Severe Thunderstorm Warning",
                   "THUNDERSTORM DAMAGE THREAT...DESTRUCTIVE"),
                wx("old", "Tornado Warning",
                   expires=utcnow() - timedelta(minutes=5)),
            ],
        )  # fmt: skip
        events = {
            e.key: e for e in (await db.execute(select(Event))).scalars()
        }
        assert set(events) == {"nws:t1", "nws:s1", "nws:old"}
        assert events["nws:t1"].severity == 5
        assert events["nws:t1"].title.startswith("Tornado Warning: Davidson")
        assert events["nws:s1"].severity == 3
        await fusion.expire_and_prune(db, 30, 30)
        await db.commit()
        assert events["nws:old"].status == "expired"
        assert events["nws:t1"].status == "active"
