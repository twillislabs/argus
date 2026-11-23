from argus import fireperims

DOC = {
    "features": [
        {
            "properties": {
                "poly_IncidentName": "TIMBER",
                "poly_GISAcres": 25349.5,
                "attr_PercentContained": 80,
                "attr_UniqueFireIdentifier": "2026-CALPF-002271",
                "attr_POOState": "US-CA",
                "attr_FireDiscoveryDateTime": 1786246500000,
                "poly_DateCurrent": 1791537522000,
            },
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    [
                        [
                            [-120.0, 38.0],
                            [-119.9, 38.0],
                            [-119.9, 38.1],
                            [-120.0, 38.1],
                            [-120.0, 38.0],
                        ]
                    ],
                    [[[-119.0, 38.0], [-118.99, 38.0], [-119.0, 38.0]]],
                ],
            },
        },
        {
            "properties": {
                "poly_IncidentName": "Hill Complex",
                "poly_GISAcres": 500,
                "attr_UniqueFireIdentifier": "2026-ORXXX-000001",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[-122, 44], [-121.9, 44], [-121.9, 44.1], [-122, 44]]
                ],
            },
        },
        {"properties": {"poly_GISAcres": 900}, "geometry": None},
    ]
}


def test_parse_perimeters():
    fires = fireperims.parse_perimeters(DOC)
    assert [f["name"] for f in fires] == ["Timber Fire", "Hill Complex"]
    timber = fires[0]
    assert timber["event_key"] == "nifc:2026-CALPF-002271"
    assert timber["acres"] == 25350 and timber["contained"] == 80
    assert timber["state"] == "CA"
    # The sliver ring (3 points) is dropped; the square kept.
    assert len(timber["rings"]) == 1 and len(timber["rings"][0]) == 5
    assert timber["lat"] == 38.05 and timber["lon"] == -119.95
    assert timber["discovered"].startswith("2026-")
    assert fires[1]["contained"] is None
