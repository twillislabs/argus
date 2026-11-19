import json
import os
from datetime import UTC, datetime, timedelta

from argus.collectors.airspace import parse_czibs, parse_sigmets, parse_tfrs
from argus.fusion import store_raw

HERE = os.path.dirname(__file__)
NOW = datetime(2026, 11, 19, 1, 0, tzinfo=UTC)


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
        return json.load(f)


CZIB_PAGE = """
<table><tbody>
<tr><td>30/09/2026</td><td>16/11/2026</td><td>31/01/2027</td>
<td><a href="/en/domains/air-operations/czibs/2026-09-r2">Airspace of Saudi
Arabia</a> CZIB-2026-09-R2 <span>Active</span></td><td></td></tr>
<tr><td>14/07/2026</td><td>16/11/2026</td><td>31/01/2027</td>
<td>Airspace of the Persian Gulf and Gulf of Oman CZIB-2026-07R4 Active</td></tr>
<tr><td>01/01/2025</td><td>01/02/2025</td><td>01/03/2025</td>
<td>Airspace of Libya CZIB-2025-01-R1 Withdrawn</td></tr>
</tbody></table>
"""


def test_parse_tfrs_keeps_only_current():
    data = fixture("tfr.json")
    stale = json.loads(json.dumps(data["shapes"]["features"][0]))
    stale["properties"]["NOTAM_KEY"] = "1/0001-1-FDC-F"
    data["shapes"]["features"].append(stale)
    rows = parse_tfrs(data["list"], data["shapes"], NOW)
    assert len(rows) == len(data["shapes"]["features"]) - 1
    p = rows[0].payload
    assert p["kind"] == "tfr" and p["id"].startswith("TFR ")
    assert len(p["polygon"]) >= 4 and rows[0].lat is not None
    # Ids are stable from run to run.
    again = parse_tfrs(data["list"], data["shapes"], NOW)
    assert [r.external_id for r in again] == [r.external_id for r in rows]


def test_parse_sigmets():
    data = fixture("sigmet.json")
    soon = datetime(2026, 11, 18, 23, 0, tzinfo=UTC)
    intl = parse_sigmets(data["isigmet"], soon, international=True)
    us = parse_sigmets(data["airsigmet"], soon, international=False)
    assert intl[0].payload["hazard"] == "Volcanic ash"
    assert "Eruption" in intl[0].payload["title"]
    assert intl[0].payload["top_ft"] == 7000
    assert us[0].payload["hazard"] == "Turbulence"
    assert us[0].payload["area"] == "United States"
    # Ended ones are dropped.
    later = soon + timedelta(days=2)
    assert parse_sigmets(data["isigmet"], later, international=True) == []


def test_parse_czibs():
    rows = parse_czibs(CZIB_PAGE, NOW)
    assert [r.external_id for r in rows] == [
        "CZIB-2026-09-R2",
        "CZIB-2026-07R4",
    ]
    saudi = rows[0].payload
    assert saudi["countries"] == ["Saudi Arabia"]
    assert saudi["valid_to"] == "2027-01-31"
    assert saudi["url"].endswith("/2026-09-r2")
    assert rows[1].payload["countries"] == []


async def test_airspace_api(admin_client, app):
    data = fixture("tfr.json")
    soon = datetime.now(UTC)
    records = parse_tfrs(data["list"], data["shapes"], soon) + parse_czibs(
        CZIB_PAGE, soon
    )
    expired = parse_czibs(CZIB_PAGE.replace("31/01/2027", "01/01/2020"), soon)
    for r in expired:
        r.external_id = "old-{0}".format(r.external_id)
    async with app.state.db.sessionmaker() as db:
        await store_raw(db, records + expired)
        await db.commit()
    items = (await admin_client.get("/api/airspace")).json()["items"]
    kinds = sorted({i["kind"] for i in items})
    assert kinds == ["czib", "tfr"]
    assert not any(i["key"].startswith("czib:old-") for i in items)
    assert any(i["polygon"] for i in items if i["kind"] == "tfr")
