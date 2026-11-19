import httpx

from argus import advisories

US = [
    {
        "Title": "Iran - Level 4: Do Not Travel",
        "Link": "https://travel.state.gov/iran",
        "Category": ["IR"],
        "Summary": "<p>Do not travel to <b>Iran</b>.</p>",
        "Updated": "2026-10-22T20:00:00-04:00",
    },
    {"Title": "Gaza - Level 4: Do Not Travel", "Summary": ""},
    {"Title": "The West Bank - Level 3: Reconsider Travel", "Summary": ""},
    {"Title": "Burma - Level 4: Do Not Travel", "Summary": ""},
    {"Title": "Not an advisory", "Summary": ""},
]


def index(updated="2026-11-19T10:00:00Z"):
    def child(name, slug):
        return {
            "details": {
                "country": {"name": name, "slug": slug},
                "change_description": "Updated <b>safety</b> info",
            },
            "public_updated_at": updated,
            "web_url": "https://www.gov.uk/foreign-travel-advice/" + slug,
        }

    return {
        "links": {
            "children": [
                child("Ukraine", "ukraine"),
                child("Myanmar (Burma)", "myanmar"),
                child("France", "france"),
            ]
        }
    }


PAGES = {
    "ukraine": [
        "avoid_all_travel_to_parts",
        "avoid_all_but_essential_travel_to_parts",
    ],
    "myanmar": ["avoid_all_travel_to_whole_country"],
    "france": [],
}


def test_parse_us_maps_names_and_keeps_the_worst():
    us = advisories.parse_us(US)
    assert us["Iran"]["level"] == 4
    assert us["Iran"]["summary"] == "Do not travel to Iran."
    assert us["Palestine"]["level"] == 4  # Gaza beats the West Bank
    assert "Myanmar" in us and "Burma" not in us
    assert len(us) == 3


async def test_fetch_and_merge_refetches_only_changed_uk_pages():
    calls = []

    def handler(request):
        url = str(request.url)
        calls.append(url)
        if url == advisories.US_URL:
            return httpx.Response(200, json=US)
        if url == advisories.UK_INDEX:
            return httpx.Response(200, json=index())
        slug = url.rsplit("/", 1)[-1]
        return httpx.Response(
            200, json={"details": {"alert_status": PAGES[slug]}}
        )

    advisories.UK_GAP_S = 0
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    ) as client:
        value = await advisories.fetch(client, {})
        assert value["uk"]["Ukraine"]["level"] == 3
        assert value["uk"]["Myanmar"]["level"] == 4
        assert value["uk"]["France"]["level"] == 1
        rows = advisories.merged(value)
        assert rows[0]["level"] == 4
        myanmar = next(r for r in rows if r["country"] == "Myanmar")
        assert myanmar["us"]["level"] == 4 and myanmar["uk"]["level"] == 4
        # A second pass with nothing changed only reads the two lists.
        calls.clear()
        again = await advisories.fetch(client, value)
        assert len(calls) == 2
        assert again["uk"] == value["uk"]


async def test_advisories_api(app, admin_client):
    from argus.models import ServerSetting

    async with app.state.db.sessionmaker() as db:
        db.add(
            ServerSetting(
                key="layer:advisories",
                value={
                    "fetched": "2026-11-19T00:00:00+00:00",
                    "us": advisories.parse_us(US),
                    "uk": {},
                },
            )
        )
        await db.commit()
    r = (await admin_client.get("/api/advisories")).json()
    assert r["countries"][0]["level"] == 4
    assert {c["country"] for c in r["countries"]} == {
        "Iran",
        "Palestine",
        "Myanmar",
    }
