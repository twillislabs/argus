import json
import os
from datetime import UTC, datetime

from argus.collectors import firms, gdelt, rss, usgs

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def gdelt_row(**over):
    """A 61-column GDELT export row with sensible defaults."""
    r = [""] * 61
    r[gdelt.C_ID] = over.get("id", "1001")
    r[gdelt.C_ACTOR1] = over.get("actor1", "MILITARY")
    r[gdelt.C_ACTOR2] = over.get("actor2", "REBEL")
    r[gdelt.C_ROOT_FLAG] = "1"
    r[gdelt.C_CODE] = over.get("code", "194")
    r[gdelt.C_ROOT] = over.get("root", "19")
    r[gdelt.C_GOLDSTEIN] = "-10"
    r[gdelt.C_MENTIONS] = "8"
    r[gdelt.C_SOURCES] = "2"
    r[gdelt.C_ARTICLES] = str(over.get("articles", 4))
    r[gdelt.C_TONE] = "-6.5"
    r[gdelt.C_GEO_TYPE] = over.get("geo_type", "4")
    r[gdelt.C_GEO_NAME] = over.get(
        "place", "Kharkiv, Kharkivs'ka Oblast', Ukraine"
    )
    r[gdelt.C_GEO_CC] = "UP"
    r[gdelt.C_LAT] = str(over.get("lat", 49.98))
    r[gdelt.C_LON] = str(over.get("lon", 36.25))
    r[gdelt.C_ADDED] = over.get("added", "20261118200000")
    r[gdelt.C_URL] = over.get("url", "https://news.example.com/a")
    return r


def test_usgs_parse():
    with open(os.path.join(FIXTURES, "usgs_day.geojson")) as f:
        records = usgs.parse(json.load(f))
    assert len(records) == 3
    first = records[0]
    assert first.kind == "quake"
    assert first.payload["mag"] == 6.1
    assert first.observed_at.tzinfo is not None
    assert -90 <= first.lat <= 90


def test_gdelt_keeps_city_level_conflict_and_protest():
    rows = [
        gdelt_row(id="1"),
        gdelt_row(id="2", root="14", code="141"),
        gdelt_row(id="3", root="04", code="040"),  # consult: dropped
        gdelt_row(id="4", geo_type="1"),  # country centroid: dropped
    ]
    records = gdelt.parse_rows(rows)
    assert [r.external_id for r in records] == ["1", "2"]
    assert records[0].payload["type"] == "conflict"
    assert records[0].payload["label"] == "Artillery and tank fighting"
    assert records[1].payload["type"] == "unrest"
    assert records[0].observed_at == datetime(2026, 11, 18, 20, tzinfo=UTC)


def test_gdelt_stamps():
    assert gdelt.stamps_to_fetch("20261118200000", "20261118193000") == [
        "20261118194500",
        "20261118200000",
    ]
    # No cursor: a bounded backfill ending at the latest file.
    slots = gdelt.stamps_to_fetch("20261118200000", None, limit=3)
    assert slots == ["20261118193000", "20261118194500", "20261118200000"]
    # Very old cursor: still bounded.
    assert len(gdelt.stamps_to_fetch("20261118200000", "20260101000000")) == 8


def test_gdelt_label_fallback():
    assert gdelt.label_for("1952") == "Drone attack"
    assert gdelt.label_for("1959") == "Aerial attack"
    assert gdelt.label_for("999") == "Incident"


def test_firms_cluster():
    header = (
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,"
        "satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"
    )
    lines = [
        "{0},{1},330,0.4,0.4,2026-11-18,{2},N,VIIRS,h,2.0NRT,290,{3},D".format(
            -12.60 + i * 0.001, -55.50 + i * 0.001, 1400 + i, 20 + i
        )
        for i in range(10)
    ]
    lines.append(
        "10.0,10.0,330,0.4,0.4,2026-11-18,1200,N,VIIRS,h,2.0NRT,290,5,D"
    )
    records = firms.cluster(header + "\n".join(lines))
    assert len(records) == 1
    rec = records[0]
    assert rec.payload["detections"] == 10
    assert rec.payload["max_frp"] == 29.0
    assert rec.observed_at.hour == 14


RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>T</title>
<item><title>Quake shakes &lt;b&gt;Chile&lt;/b&gt;</title>
<link>https://example.com/quake</link>
<pubDate>Wed, 18 Nov 2026 19:00:00 GMT</pubDate>
<description>&lt;p&gt;A strong quake hit &lt;a href="x"&gt;Chile&lt;/a&gt;.&lt;/p&gt;</description>
</item>
<item><title>No link</title></item>
<item><title>Bad scheme</title><link>javascript:alert(1)</link></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
<entry><title>Atom story</title>
<link rel="alternate" href="https://example.com/atom"/>
<updated>2026-11-18T18:30:00Z</updated><summary>Short</summary></entry>
</feed>"""

BOMB = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>
<rss><channel><item><title>&lol2;</title></item></channel></rss>"""


def test_rss_parse_rss2():
    now = datetime(2026, 11, 18, 21, tzinfo=UTC)
    records = rss.parse_feed("Example", RSS, now)
    assert len(records) == 1
    p = records[0].payload
    assert p["title"] == "Quake shakes Chile"
    assert p["summary"] == "A strong quake hit Chile ."
    assert records[0].observed_at == datetime(2026, 11, 18, 19, tzinfo=UTC)


def test_rss_parse_atom():
    now = datetime(2026, 11, 18, 21, tzinfo=UTC)
    records = rss.parse_feed("Example", ATOM, now)
    assert records[0].payload["url"] == "https://example.com/atom"


def test_rss_rejects_entity_expansion():
    import pytest
    from defusedxml import EntitiesForbidden

    with pytest.raises(EntitiesForbidden):
        rss.parse_feed("Evil", BOMB, datetime.now(UTC))


def test_rss_future_dates_clamped():
    now = datetime(2026, 11, 18, 12, tzinfo=UTC)
    records = rss.parse_feed("Example", RSS, now)
    assert records[0].observed_at == now
