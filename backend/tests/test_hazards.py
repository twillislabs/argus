import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from argus.collectors.hazards import parse_eonet, parse_gdacs, parse_tsunami
from argus.fusion import fuse, store_raw
from argus.models import Event

HERE = os.path.dirname(__file__)
NOW = datetime(2026, 11, 19, 1, 0, tzinfo=UTC)

GDACS = {
    "features": [
        {
            "geometry": {"type": "Point", "coordinates": [120.5, 15.2]},
            "properties": {
                "eventtype": "TC",
                "eventid": 1001,
                "name": "Tropical Cyclone ALPHA-26",
                "htmldescription": "Orange alert for ALPHA-26.",
                "alertlevel": "Orange",
                "iscurrent": "true",
                "country": "Philippines",
                "url": {"report": "https://www.gdacs.org/report.aspx?x=1"},
            },
        },
        {
            # Earthquakes come from USGS instead.
            "geometry": {"type": "Point", "coordinates": [10, 10]},
            "properties": {
                "eventtype": "EQ",
                "eventid": 2,
                "iscurrent": "true",
            },
        },
        {
            "geometry": {"type": "Point", "coordinates": [10, 10]},
            "properties": {
                "eventtype": "FL",
                "eventid": 3,
                "alertlevel": "Green",
                "iscurrent": "false",
            },
        },
    ]
}

EONET = {
    "events": [
        {
            "id": "EONET_1",
            "title": "Hurricane Bravo",
            "categories": [{"id": "severeStorms"}],
            "sources": [{"url": "https://www.nhc.noaa.gov/"}],
            "geometry": [
                {
                    "type": "Point",
                    "coordinates": [-70.0, 20.0],
                    "magnitudeValue": 60,
                    "date": "2026-11-18T00:00:00Z",
                },
                {
                    "type": "Point",
                    "coordinates": [-71.0, 21.0],
                    "magnitudeValue": 105,
                    "date": "2026-11-18T06:00:00Z",
                },
            ],
        },
        {
            "id": "EONET_3",
            "title": "Prescribed Fire Compartment 170 RX, Greene, Georgia",
            "categories": [{"id": "wildfires"}],
            "geometry": [{"type": "Point", "coordinates": [-83, 33]}],
        },
        {
            "id": "EONET_2",
            "title": "Iceberg A23A",
            "categories": [{"id": "seaLakeIce"}],
            "geometry": [{"type": "Point", "coordinates": [-40, -60]}],
        },
    ]
}


def test_parse_gdacs():
    rows = parse_gdacs(GDACS, NOW)
    assert len(rows) == 1
    r = rows[0]
    assert r.external_id == "TC1001" and r.kind == "hazard"
    assert r.payload["hazard"] == "cyclone" and r.payload["severity"] == 3
    assert (r.lat, r.lon) == (15.2, 120.5)


def test_parse_eonet():
    rows = parse_eonet(EONET, NOW)
    assert [r.external_id for r in rows] == ["EONET_1"]
    p = rows[0].payload
    # Latest position, and 105 kt is a major hurricane.
    assert (rows[0].lat, rows[0].lon) == (21.0, -71.0)
    assert p["severity"] == 4 and p["knots"] == 105
    assert p["track"] == [[-70.0, 20.0], [-71.0, 21.0]]


def test_parse_tsunami():
    with open(os.path.join(HERE, "fixtures", "tsunami_info.xml"), "rb") as f:
        xml = f.read()
    soon = datetime(2026, 11, 14, 0, 0, tzinfo=UTC)
    rows = parse_tsunami(xml, "NTWC", soon)
    assert len(rows) == 1
    p = rows[0].payload
    assert p["hazard"] == "tsunami" and p["severity"] == 1
    assert "Kodiak" in p["title"]
    # Bulletins older than two days are ignored.
    assert parse_tsunami(xml, "NTWC", soon + timedelta(days=3)) == []


def test_tsunami_warning_is_critical():
    xml = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
  <title>Tsunami Warning Number 2</title>
  <entry>
    <title>Off the coast of Chile</title>
    <updated>2026-11-19T00:30:00Z</updated>
    <geo:lat>-33.0</geo:lat><geo:long>-72.0</geo:long>
    <summary>Category: Warning. Hazardous tsunami waves are possible.</summary>
    <id>urn:uuid:abc</id>
  </entry>
</feed>"""
    rows = parse_tsunami(xml, "PTWC", NOW)
    assert rows[0].payload["severity"] == 5


async def test_hazards_become_events(app):
    async with app.state.db.sessionmaker() as db:
        rows = await store_raw(db, parse_gdacs(GDACS, NOW))
        await fuse(db, rows)
        await db.commit()
        event = (await db.execute(select(Event))).scalar_one()
        assert event.type == "hazard" and event.severity == 3
        assert event.title == "Tropical Cyclone ALPHA-26"
        assert event.data["label"] == "Tropical cyclone"
        # A later run updates the same event.
        later = parse_gdacs(GDACS, NOW + timedelta(hours=1))
        later[0].payload["severity"] = 4
        rows = await store_raw(db, later)
        await fuse(db, rows)
        await db.commit()
        events = (await db.execute(select(Event))).scalars().all()
        assert len(events) == 1 and events[0].severity == 4
