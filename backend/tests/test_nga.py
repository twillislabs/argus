from datetime import UTC, datetime

from sqlalchemy import select

from argus.collectors import nga
from argus.fusion import fuse, store_raw
from argus.models import Event

NOW = datetime(2026, 11, 19, 1, 0, tzinfo=UTC)

DOC = {
    "broadcast-warn": [
        {
            "msgYear": 2026,
            "msgNumber": 1234,
            "navArea": "4",
            "subregion": "11",
            "status": "A",
            "issueDate": "181530Z NOV 2026",
            "authority": "FLEET COMMAND 171200Z NOV 26",
            "text": (
                "NAVAREA IV 1234/26(11).\n"
                "VIRGINIA CAPES.\n"
                "HAZARDOUS OPERATIONS, ROCKET LAUNCHING\n"
                "200100Z TO 200500Z NOV IN AREA BOUND BY\n"
                "37-50.00N 075-29.00W, 37-46.00N 074-55.00W,\n"
                "37-20.00N 075-05.00W.\n"
                "2. CANCEL THIS MSG 200600Z NOV 26."
            ),
        },
        {
            "msgYear": 2026,
            "msgNumber": 88,
            "navArea": "P",
            "status": "A",
            "text": "HYDROPAC 88/26(61).\nGULF OF ADEN.\nPIRACY ATTACK 12-30N 045-10E.",
        },
        {
            # No positions: can't be placed.
            "msgYear": 2026,
            "msgNumber": 5,
            "navArea": "12",
            "status": "A",
            "text": "NAVAREA XII 5/26.\nCANCEL NAVAREA XII 3/26.",
        },
        {
            "msgYear": 2026,
            "msgNumber": 6,
            "navArea": "12",
            "status": "C",
            "text": "Cancelled 10-00N 100-00W.",
        },
    ]
}


def test_positions_and_severity():
    pts = nga.positions("37-50.00N 075-29.00W and 12-30S 045-10.5E")
    assert pts == [(37.8333, -75.4833), (-12.5, 45.175)]
    assert nga.severity("ROCKET LAUNCHING") == 2
    assert nga.severity("PIRACY ATTACK") == 3
    assert nga.severity("BUOY OFF STATION") == 1


def test_parse():
    rows = nga.parse(DOC, NOW)
    assert [r.external_id for r in rows] == [
        "NAVAREA IV 1234/26",
        "HYDROPAC 88/26",
    ]
    first = rows[0].payload
    assert first["title"] == "Virginia capes"
    assert len(first["points"]) == 3 and first["severity"] == 2
    assert rows[1].payload["severity"] == 3
    assert (rows[1].lat, rows[1].lon) == (12.5, 45.1667)


async def test_warnings_become_events(app):
    async with app.state.db.sessionmaker() as db:
        rows = await store_raw(db, nga.parse(DOC, NOW))
        await fuse(db, rows)
        await db.commit()
        events = (
            (await db.execute(select(Event).order_by(Event.title)))
            .scalars()
            .all()
        )
        assert [e.type for e in events] == ["maritime", "maritime"]
        piracy = next(e for e in events if "HYDROPAC" in e.title)
        assert piracy.severity == 3 and piracy.place == "HYDROPAC"
        assert (
            len(next(e for e in events if e is not piracy).data["points"]) == 3
        )
