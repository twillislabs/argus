from argus import storms
from argus.api import weather

EVENT = {
    "eventid": 1001350,
    "episodeid": 14,
    "eventname": "XAVIER-26",
    "name": "Tropical Cyclone XAVIER-26",
    "alertlevel": "Orange",
    "iscurrent": "true",
    "country": "Cook Islands",
    "datemodified": "2026-11-20T22:05:05",
}
SQUARE = [[-164, -12], [-163, -12], [-163, -11], [-164, -11], [-164, -12]]


def feature(cls, geometry, **props):
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {"Class": cls, **props},
    }


def line(a, b, cat, forecast):
    return feature(
        "Line_Line_{0}".format(a[0]),
        {"type": "LineString", "coordinates": [a, b]},
        polygonlabel=cat,
        forecast=forecast,
    )


GEOMETRY = {
    "type": "FeatureCollection",
    "features": [
        feature(
            "Point_Centroid",
            {"type": "Point", "coordinates": [-163.9, -11.3]},
            polygonlabel="Centroid",
        ),
        # GDACS lists segments in no order: a later forecast one first.
        line([-165.0, -11.8], [-166.1, -12.3], "TD", True),
        line([-162.8, -11.0], [-163.9, -11.3], "HU", False),
        line([-163.9, -11.3], [-165.0, -11.8], "TS", True),
        feature(
            "Poly_Cones",
            {"type": "Polygon", "coordinates": [SQUARE]},
            polygonlabel="Uncertainty Cones",
        ),
        feature(
            "Poly_Red",
            {"type": "Polygon", "coordinates": [SQUARE]},
            polygonlabel="120 km/h",
        ),
        # Wind radii for one forecast time: not part of the swath.
        feature(
            "Poly_Red",
            {"type": "Polygon", "coordinates": [SQUARE]},
            polygonlabel="21/11 06:00",
            featuretype="WindRadii",
        ),
        feature(
            "Point_Polygon_Point_0",
            {"type": "Polygon", "coordinates": [SQUARE]},
            polygonlabel="15/11 06:00 UTC",
            featuretype="PointRadii",
        ),
    ],
}


def test_parse_geometry():
    s = storms.parse_geometry(GEOMETRY, EVENT)
    assert s["name"] == "XAVIER-26" and s["level"] == 3
    assert s["position"] == [-163.9, -11.3]
    # The segment leaving the current position, not the first listed.
    assert s["category"] == "TS"
    assert len(s["track"]) == 3
    assert sum(t["forecast"] for t in s["track"]) == 2
    assert len(s["cone"]) == 1
    assert [w["label"] for w in s["swath"]] == ["120 km/h"]
    assert s["report"].endswith("eventid=1001350&episodeid=14")


def test_parse_geometry_without_shapes():
    assert storms.parse_geometry({"features": []}, EVENT) is None


def test_current_events_only():
    doc = {
        "features": [
            {"properties": {**EVENT, "alertlevel": "Green"}},
            {"properties": {**EVENT, "eventid": 2, "iscurrent": "false"}},
            {"properties": {**EVENT, "eventid": 3, "alertlevel": "Red"}},
        ]
    }
    ids = [e["eventid"] for e in storms.current_events(doc)]
    assert ids == [3, 1001350]


def test_forecast_rows_start_at_the_current_hour():
    body = {"current": {"time": "2026-11-20T14:15"}}
    cols = {
        "time": ["2026-11-20T12:00", "2026-11-20T13:00", "2026-11-20T14:00",
                 "2026-11-20T15:00"],
        "temperature_2m": [10, 11, 12, 13],
    }  # fmt: skip
    rows = weather._rows(cols, 2, body)
    assert rows == [
        {"time": "2026-11-20T14:00", "temperature_2m": 12},
        {"time": "2026-11-20T15:00", "temperature_2m": 13},
    ]


async def test_storms_endpoint(app, admin_client, monkeypatch):
    async def get(since):
        assert len(since) == 10
        return {"status": "ok", "storms": [], "source": "GDACS"}

    monkeypatch.setattr(app.state.storms, "get", get)
    body = (await admin_client.get("/api/weather/storms")).json()
    assert body["status"] == "ok"
