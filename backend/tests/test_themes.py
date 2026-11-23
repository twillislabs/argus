import pytest

from argus import themes
from tests.conftest import csrf

GOOD = {
    "id": "harbour",
    "name": "Harbour",
    "base": "cyber",
    "colors": {"bg": "#0b1016", "accent": "rgba(63, 208, 201, 0.9)"},
    "map": {"land": "#14202c"},
    "fonts": {"head": "orbitron", "mono": "sharetech"},
    "corners": "cut",
    "radius": 4,
    "glow": 0.5,
    "overlay": "scanlines",
    "stripe": "neon",
}


def test_clean_keeps_a_good_theme():
    t = themes.clean(GOOD)
    assert t["id"] == "harbour" and t["base"] == "cyber"
    assert t["colors"]["accent"] == "rgba(63, 208, 201, 0.9)"
    assert t["glow"] == 0.5 and t["radius"] == 4.0


@pytest.mark.parametrize(
    "change",
    [
        {"id": "dark"},
        {"id": "Bad Id"},
        {"name": " "},
        {"base": "nope"},
        {"colors": {"bg": "red; background: url(x)"}},
        {"colors": {"bg": "url(https://evil)"}},
        {"colors": {"nope": "#fff"}},
        {"fonts": {"head": "Comic Sans"}},
        {"corners": "wavy"},
        {"overlay": "url(x)"},
        {"glow": 2},
        {"radius": -1},
    ],
)
def test_clean_refuses(change):
    with pytest.raises(themes.ThemeError):
        themes.clean(GOOD | change)


def test_clean_all_refuses_duplicates():
    with pytest.raises(themes.ThemeError):
        themes.clean_all([GOOD, GOOD])


async def test_theme_api(client, admin_client):
    r = await client.get("/api/theme")
    assert r.json() == {"default": "dark", "theme": None}
    r = await admin_client.put(
        "/api/admin/themes", json={"items": [GOOD]}, headers=csrf(admin_client)
    )
    assert r.status_code == 200, r.text
    r = await admin_client.put(
        "/api/admin/themes",
        json={"items": [GOOD | {"colors": {"bg": "expression(x)"}}]},
        headers=csrf(admin_client),
    )
    assert r.status_code == 422
    r = await admin_client.put(
        "/api/admin/defaults",
        json={"theme": "harbour"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 200, r.text
    r = (await client.get("/api/theme")).json()
    assert r["default"] == "harbour" and r["theme"]["name"] == "Harbour"
    me = (await admin_client.get("/api/me")).json()
    assert [t["id"] for t in me["themes"]] == ["harbour"]
    r = await admin_client.patch(
        "/api/me/preferences",
        json={"theme": "cassette"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 200
    assert r.json()["preferences"]["theme"] == "cassette"
    r = await admin_client.patch(
        "/api/me/preferences",
        json={"theme": "Not An Id"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 422
