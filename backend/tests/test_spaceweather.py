import json
from datetime import UTC, datetime
from pathlib import Path

from argus import spaceweather

FIX = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


def test_scales():
    s = spaceweather.parse_scales(load("swpc_scales.json"))
    assert s["now"]["G"] == {
        "scale": 0,
        "text": "none",
        "name": "Geomagnetic storm",
    }
    assert len(s["forecast"]) == 3
    assert s["forecast"][0]["r_minor_pct"] == 15


def test_kp():
    kp = spaceweather.parse_kp(load("swpc_kp.json"))
    assert kp["now"] == 3.0 and kp["at"] == "2026-11-19T18:00:00"
    assert len(kp["recent"]) == 8 and kp["max_24h"] >= kp["now"]
    # The older list-of-lists shape too.
    old = [["time_tag", "Kp"], ["2026-11-19 18:00:00.000", "5.33"]]
    assert spaceweather.parse_kp(old)["now"] == 5.33
    assert spaceweather.parse_kp([])["now"] is None


def test_alerts():
    now = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
    alerts = spaceweather.parse_alerts(load("swpc_alerts.json"), now)
    assert alerts and alerts[0]["issued"] >= alerts[-1]["issued"]
    assert alerts[0]["kind"] == "Extended Warning"
    assert alerts[0]["headline"].startswith("Geomagnetic K-index of 4")
    later = datetime(2026, 11, 25, tzinfo=UTC)
    assert spaceweather.parse_alerts(load("swpc_alerts.json"), later) == []
