from argus import places, video, youtube


def test_parse_dailymotion():
    doc = {
        "list": [
            {
                "id": "xbc69gm",
                "title": "Directo | Sánchez interviene en Nueva York",
                "owner.screenname": "El Confidencial",
                "onair": True,
                "thumbnail_360_url": "https://s2.dmcdn.net/x360",
            },
            {"id": "x123abc", "title": "Paris live", "onair": False},
            {"id": "bad id", "title": "Paris", "onair": True},
            {"id": "x9kxf22", "title": "Morning show", "onair": True},
        ]
    }
    hits = video.parse_dailymotion(doc, ["nueva york"])
    assert [h["id"] for h in hits] == ["xbc69gm"]
    assert hits[0]["platform"] == "dailymotion" and hits[0]["live"]
    assert hits[0]["thumb"].startswith("https://")
    # No words: any live video (a country's broadcasters).
    assert [h["id"] for h in video.parse_dailymotion(doc, None)] == [
        "xbc69gm",
        "x9kxf22",
    ]


def test_channel_input_dailymotion_and_kick():
    assert youtube.parse_channel_input(
        "https://www.dailymotion.com/france24"
    ) == ("dailymotion", "france24")
    assert youtube.parse_channel_input("https://kick.com/SomeOne") == (
        "kick",
        "someone",
    )
    assert (
        youtube.parse_channel_input("https://www.dailymotion.com/video/x8abc")
        is None
    )
    assert youtube.valid_channel("kick", "some-one")
    assert not youtube.valid_channel("kick", "../etc")
    assert youtube.valid_channel("dailymotion", "euronews-en")


async def test_kick_resolves_to_its_player():
    ids = youtube.LiveIds("test")
    found = await ids.resolve("someone", "kick")
    assert found["video_id"] == "someone" and found["platform"] == "kick"
    assert found["unverified"]
    await ids.close()


def test_largest_near_skips_districts():
    names = [p.name for p in places.largest_near(48.86, 2.35, 60)]
    assert names[0] == "Paris"
    assert not any(n.startswith("Paris ") for n in names)
