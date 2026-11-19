import json
from datetime import UTC, datetime
from pathlib import Path

from argus import cyber

FIX = Path(__file__).parent / "fixtures"


def test_outages():
    doc = json.loads((FIX / "ioda_country.json").read_text())
    # The fixture's newest events start around 1794936600.
    out = cyber.parse_outages(doc, now=1794950000)
    assert out and out == sorted(out, key=lambda o: -o["score"])
    fi = next(o for o in out if o["cc"] == "FI")
    assert fi["country"] == "Finland" and fi["source"] == "Google traffic"
    # An ASN-level event is ignored; a long-past one too.
    extra = {
        "data": [
            {
                "location": "asn/1",
                "start": 1794940000,
                "duration": 60,
                "score": 9e9,
            },
            {
                "location": "country/US",
                "start": 1,
                "duration": 60,
                "score": 9e9,
            },
        ]
    }
    assert cyber.parse_outages(extra, now=1794950000) == []


def test_ransomware_counts_without_names():
    now = datetime(2026, 11, 19, 18, tzinfo=UTC)
    rows = [
        {
            "victim": "Example Co",
            "country": "US",
            "attackdate": "2026-11-19T10:00:00+00:00",
            "activity": "Healthcare",
            "group": "groupa",
        },
        {
            "victim": "Other Co",
            "country": "US",
            "attackdate": "2026-11-18T10:00:00+00:00",
            "activity": "Healthcare",
            "group": "groupb",
        },
        {
            "victim": "Old",
            "country": "DE",
            "attackdate": "2026-10-01T00:00:00",
        },
        {
            "victim": "Nowhere",
            "country": "",
            "attackdate": "2026-11-19T00:00:00",
        },
    ]
    out = cyber.parse_ransomware(rows, now)
    assert [o["cc"] for o in out] == ["US"]
    us = out[0]
    assert us["count"] == 2 and us["sectors"] == ["Healthcare"]
    # The list starts at its oldest recent claim, wherever it was.
    assert us["since"].startswith("2026-11-18T10")
    assert set(us["groups"]) == {"groupa", "groupb"}
    assert "Example Co" not in json.dumps(out)


def test_kev_newest_first():
    doc = json.loads((FIX / "kev.json").read_text())
    out = cyber.parse_kev(doc)
    assert len(out) == 5
    assert out[0]["added"] >= out[-1]["added"]
    assert out[0]["cve"].startswith("CVE-")


async def test_cyber_endpoint(admin_client):
    body = (await admin_client.get("/api/cyber")).json()
    assert body["outages"] == [] and body["kev"] == []
