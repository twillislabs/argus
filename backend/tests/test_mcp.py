import httpx

from tests.conftest import csrf


async def make_token(admin_client) -> str:
    r = await admin_client.post(
        "/api/me/tokens", json={"name": "Claude"}, headers=csrf(admin_client)
    )
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    assert token.startswith("argus_")
    return token


def bearer(app, token: str | None) -> httpx.AsyncClient:
    headers = {"Authorization": "Bearer " + token} if token else {}
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=headers,
    )


async def test_token_lifecycle_and_limits(app, admin_client):
    token = await make_token(admin_client)
    listed = (await admin_client.get("/api/me/tokens")).json()["tokens"]
    assert [t["name"] for t in listed] == ["Claude"]
    assert "token" not in listed[0]  # shown once, never again

    async with bearer(app, token) as c:
        assert (await c.get("/api/summary")).status_code == 200
        # Read-only, and map data only.
        assert (await c.get("/api/admin/users")).status_code == 403
        assert (await c.get("/api/me")).status_code == 403
        assert (await c.get("/api/me/tokens")).status_code == 403
        r = await c.post("/api/alert-rules", json={})
        assert r.status_code == 403
    async with bearer(app, "argus_not-a-token") as c:
        assert (await c.get("/api/summary")).status_code == 401

    tid = listed[0]["id"]
    r = await admin_client.delete(
        "/api/me/tokens/{0}".format(tid), headers=csrf(admin_client)
    )
    assert r.status_code == 204
    async with bearer(app, token) as c:
        assert (await c.get("/api/summary")).status_code == 401


async def rpc(c: httpx.AsyncClient, method: str, params=None, mid=1):
    msg = {"jsonrpc": "2.0", "id": mid, "method": method}
    if params is not None:
        msg["params"] = params
    return await c.post("/api/mcp", json=msg)


async def test_mcp_protocol(app, admin_client):
    token = await make_token(admin_client)
    async with bearer(app, None) as c:
        r = await rpc(c, "initialize")
        assert r.status_code == 401
        assert "Bearer" in r.headers["www-authenticate"]
    async with bearer(app, token) as c:
        r = (
            await rpc(
                c,
                "initialize",
                {"protocolVersion": "2025-06-18", "capabilities": {}},
            )
        ).json()
        assert r["result"]["protocolVersion"] == "2025-06-18"
        assert r["result"]["serverInfo"]["name"] == "argus"
        note = await c.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        assert note.status_code == 202
        tools = (await rpc(c, "tools/list")).json()["result"]["tools"]
        names = {t["name"] for t in tools}
        assert {"get_situation", "list_events", "weather_at"} <= names
        assert all(t["annotations"]["readOnlyHint"] for t in tools)

        r = (
            await rpc(
                c, "tools/call", {"name": "get_situation", "arguments": {}}
            )
        ).json()["result"]
        assert not r.get("isError")
        assert '"summary"' in r["content"][0]["text"]

        r = (
            await rpc(c, "tools/call", {"name": "nope", "arguments": {}})
        ).json()["result"]
        assert r["isError"]
        r = (await rpc(c, "resources/list")).json()
        assert r["error"]["code"] == -32601

        # A browser on another site can't use it (DNS rebinding).
        r = await c.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            headers={"Origin": "https://evil.example"},
        )
        assert r.status_code == 403
        assert (await c.get("/api/mcp")).status_code == 405
