from types import SimpleNamespace

import httpx
import pytest

from argus.ai import features, providers
from argus.ai.providers import ProviderConfig, Result, Tool
from argus.api import ai as ai_api
from argus.db import utcnow
from argus.models import Event
from tests.conftest import csrf
from tests.test_users import create, sign_in


def test_cited_sentences_drop_uncited_and_unknown():
    text = (
        "Fighting continued near Kyiv [E:abc123]. A quake struck Chile "
        "[E:zzz999]. Things are tense. Fires burned in Spain [E:f1] [E:f2]."
    )
    out = features.cited_sentences(text, {"abc123", "f1", "f2"})
    assert out == [
        {"text": "Fighting continued near Kyiv.", "cites": ["abc123"]},
        {"text": "Fires burned in Spain.", "cites": ["f1", "f2"]},
    ]


async def enable(admin_client, **features_on):
    body = {
        "providers": {
            "anthropic": {"key": "sk-ant-test-0000-1111", "model": ""}
        },
        "features": {
            f: {"on": True, "provider": "anthropic", "model": ""}
            for f in features_on
        },
        "monthly_tokens": 100000,
    }
    r = await admin_client.put(
        "/api/admin/ai", json=body, headers=csrf(admin_client)
    )
    assert r.status_code == 200, r.text
    return r.json()


async def add_event(app, eid="abc123", title="Shelling reported in Kharkiv"):
    async with app.state.db.sessionmaker() as db:
        now = utcnow()
        db.add(
            Event(
                id=eid,
                type="conflict",
                severity=4,
                status="active",
                title=title,
                place="Kharkiv",
                country="Ukraine",
                lat=49.99,
                lon=36.23,
                first_seen=now,
                last_updated=now,
                confidence=0.8,
                source_count=3,
                article_count=2,
                data={},
            )
        )
        await db.commit()


async def test_settings_never_return_keys(admin_client):
    body = await enable(admin_client, digest=True)
    assert body["providers"]["anthropic"]["key_hint"] == "…1111"
    assert "sk-ant" not in str(body)
    got = (await admin_client.get("/api/admin/ai")).json()
    assert "sk-ant" not in str(got)
    assert got["features"]["digest"]["on"] is True
    # Keeping the key: key omitted. Removing it: "".
    await admin_client.put(
        "/api/admin/ai",
        json={"providers": {"anthropic": {"key": ""}}},
        headers=csrf(admin_client),
    )
    got = (await admin_client.get("/api/admin/ai")).json()
    assert got["providers"]["anthropic"]["key_hint"] is None


async def test_digest_keeps_only_cited(admin_client, app, monkeypatch):
    await enable(admin_client, digest=True)
    await add_event(app)

    async def fake_run(cfg, system, prompt, **kw):
        assert "abc123" in prompt and "<data>" in prompt
        assert cfg.api_key == "sk-ant-test-0000-1111"
        return Result(
            text="Shelling hit Kharkiv [E:abc123]. Unsupported claim.",
            model="claude-opus-5-5",
            input_tokens=100,
            output_tokens=20,
        )

    monkeypatch.setattr(ai_api, "run", fake_run)
    body = (await admin_client.get("/api/ai/digest")).json()
    assert body["status"] == "ok"
    assert body["sentences"] == [
        {"text": "Shelling hit Kharkiv.", "cites": ["abc123"]}
    ]
    usage = (await admin_client.get("/api/admin/ai")).json()["usage"]
    assert usage["anthropic"]["input"] == 100
    # Cached: no second call.
    monkeypatch.setattr(ai_api, "run", None)
    again = (await admin_client.get("/api/ai/digest")).json()
    assert again["sentences"] == body["sentences"]


async def test_ask_uses_tools_and_checks_citations(
    admin_client, app, monkeypatch
):
    await enable(admin_client, ask=True)
    await add_event(app)

    async def fake_run(cfg, system, prompt, *, tools, execute, **kw):
        names = {t.name for t in tools}
        assert {"search_events", "show_on_map"} <= names
        found = await execute("search_events", {"text": "kharkiv"})
        assert "abc123" in found
        await execute("show_on_map", {"lat": 49.99, "lon": 36.23})
        return Result(
            text="Yes: shelling in Kharkiv [E:abc123], not [E:madeup].",
            model="m",
            calls=[{"tool": "search_events"}, {"tool": "show_on_map"}],
        )

    monkeypatch.setattr(ai_api, "run", fake_run)
    r = await admin_client.post(
        "/api/ai/ask",
        json={"question": "Anything in Kharkiv?"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "[E:abc123]" in body["answer"] and "madeup" not in body["answer"]
    assert body["events"] == ["abc123"]
    assert body["view"]["lat"] == 49.99


async def test_feature_off_and_permissions(admin_client, app):
    r = await admin_client.post(
        "/api/ai/ask",
        json={"question": "hi there"},
        headers=csrf(admin_client),
    )
    assert r.status_code == 409 and "isn't turned on" in r.json()["detail"]
    await create(
        admin_client, username="vic", display_name="Vic", role="viewer"
    )
    users = (await admin_client.get("/api/admin/users")).json()
    vic = next(u for u in users if u["username"] == "vic")
    # The viewer can read status but not ask.
    temp = (
        await admin_client.post(
            "/api/admin/users/{0}/reset-password".format(vic["id"]),
            headers=csrf(admin_client),
        )
    ).json()["temporary_password"]
    c, _ = await sign_in(app, "vic", temp)
    await c.post(
        "/api/me/password",
        json={
            "current_password": temp,
            "new_password": "a long new passphrase",
        },
        headers=csrf(c),
    )
    status = (await c.get("/api/ai/status")).json()
    assert status["can_use"] is False
    r = await c.post(
        "/api/ai/ask", json={"question": "hi there"}, headers=csrf(c)
    )
    assert r.status_code == 403
    await c.aclose()


async def test_anthropic_tool_loop(monkeypatch):
    sent = []

    class FakeMessages:
        async def create(self, **kw):
            sent.append(kw)
            usage = SimpleNamespace(
                input_tokens=10, output_tokens=5, cache_read_input_tokens=0
            )
            if len(sent) == 1:
                return SimpleNamespace(
                    stop_reason="tool_use",
                    model="claude-opus-5-5",
                    usage=usage,
                    content=[
                        SimpleNamespace(
                            type="tool_use",
                            id="t1",
                            name="echo",
                            input={"x": 1},
                        )
                    ],
                )
            return SimpleNamespace(
                stop_reason="end_turn",
                model="claude-opus-5-5",
                usage=usage,
                content=[SimpleNamespace(type="text", text="done")],
            )

    class FakeClient:
        def __init__(self, **kw):
            assert kw["api_key"] == "k"
            self.messages = FakeMessages()

        async def close(self):
            return None

    monkeypatch.setattr(providers.anthropic, "AsyncAnthropic", FakeClient)

    async def execute(name, args):
        return "echo {0}".format(args["x"])

    out = await providers.run(
        ProviderConfig("anthropic", "claude-opus-5-5", api_key="k"),
        "sys",
        "hi",
        tools=[Tool("echo", "Echo", {"type": "object"})],
        execute=execute,
    )
    assert out.text == "done" and out.input_tokens == 20
    second = sent[1]["messages"][-1]["content"][0]
    assert second["type"] == "tool_result" and second["content"] == "echo 1"
    assert sent[0]["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert sent[0]["tools"][0]["input_schema"] == {"type": "object"}


async def test_openai_compatible_tool_loop(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content)
        calls.append(body)
        assert request.url.path == "/v1/chat/completions"
        if len(calls) == 1:
            return httpx.Response(
                200,
                json={
                    "model": "llama3.1:8b",
                    "usage": {"prompt_tokens": 7, "completion_tokens": 3},
                    "choices": [
                        {
                            "message": {
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "c1",
                                        "type": "function",
                                        "function": {
                                            "name": "echo",
                                            "arguments": '{"x": 2}',
                                        },
                                    }
                                ],
                            }
                        }
                    ],
                },
            )
        assert body["messages"][-1] == {
            "role": "tool",
            "tool_call_id": "c1",
            "content": "echo 2",
        }
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}], "usage": {}},
        )

    real = httpx.AsyncClient
    monkeypatch.setattr(
        providers.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )

    async def execute(name, args):
        return "echo {0}".format(args["x"])

    out = await providers.run(
        ProviderConfig(
            "local", "llama3.1:8b", base_url="http://ollama:11434/v1"
        ),
        "sys",
        "hi",
        tools=[Tool("echo", "Echo", {"type": "object"})],
        execute=execute,
    )
    assert out.text == "ok" and out.input_tokens == 7


async def test_cap_blocks(admin_client, app, monkeypatch):
    await enable(admin_client, digest=True)
    await add_event(app)
    from argus.ai import config

    async def used(db):
        return {utcnow().strftime("%Y-%m"): {"anthropic": {"input": 10**6}}}

    monkeypatch.setattr(config, "usage", used)
    r = await admin_client.get("/api/ai/digest")
    assert r.status_code == 409 and "cap" in r.json()["detail"]


def test_missing_model():
    with pytest.raises(providers.AiError):
        import asyncio

        asyncio.run(providers.run(ProviderConfig("openai", ""), "s", "p"))
