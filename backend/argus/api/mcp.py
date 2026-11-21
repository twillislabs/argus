"""An MCP server, so AI assistants (Claude Desktop, Claude Code and
others) can read the map: the situation, events, places, weather,
aircraft, ships, cameras and news.

POST /api/mcp speaks MCP's Streamable HTTP transport, statelessly, with
plain JSON answers (no event stream). Every request needs a read-only
API token (Authorization: Bearer argus_...; Settings > Account). Each
tool calls Argus's own API with that token, so it sees exactly what the
token's user may see, and nothing it can change.
"""

import json
from typing import Any

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from argus import __version__
from argus.api.deps import token_session

router = APIRouter(tags=["mcp"])

PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
MAX_TEXT = 60_000

INSTRUCTIONS = (
    "Argus is a self-hosted OSINT map. These tools read what it shows: "
    "events (conflict, unrest, disasters, quakes, fires), the situation "
    "score, places, weather and air quality, military aircraft, ships, "
    "traffic cameras and news. Areas are west,south,east,north in "
    "degrees. Data comes from public sources and can be wrong or late; "
    "cite the source fields when you use it."
)

AREA = {
    "west": {"type": "number", "minimum": -180, "maximum": 180},
    "south": {"type": "number", "minimum": -90, "maximum": 90},
    "east": {"type": "number", "minimum": -180, "maximum": 180},
    "north": {"type": "number", "minimum": -90, "maximum": 90},
}
READ_ONLY = {"readOnlyHint": True, "openWorldHint": True}

TOOLS = [
    {
        "name": "get_situation",
        "description": "The situation now: the 0-100 tension score and "
        "its band, the top countries by tension, and counts of events "
        "by type over the last hours.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "hours": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 168,
                    "default": 24,
                }
            },
        },
    },
    {
        "name": "list_events",
        "description": "Recent events, newest first: armed conflict, "
        "civil unrest, incidents, earthquakes, fires, disasters and more, "
        "each with its place, severity (1-5), time and source. Optionally "
        "for an area and only some types (for example quake,fire).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "hours": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 720,
                    "default": 24,
                },
                "types": {
                    "type": "string",
                    "description": "comma list of event types",
                },
                "min_severity": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "default": 2,
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 40,
                },
            }
            | AREA,
        },
    },
    {
        "name": "search",
        "description": "Search Argus for places, flights (callsign or "
        "registration), ships, satellites and events by name.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1}},
            "required": ["query"],
        },
    },
    {
        "name": "weather_at",
        "description": "Weather at a spot now, by the hour for a day and "
        "by the day for a week (Open-Meteo, metric), and its air quality "
        "(US AQI and pollutants).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lat": {"type": "number", "minimum": -90, "maximum": 90},
                "lon": {"type": "number", "minimum": -180, "maximum": 180},
            },
            "required": ["lat", "lon"],
        },
    },
    {
        "name": "military_aircraft",
        "description": "Military aircraft broadcasting their position "
        "now (ADS-B), worldwide or in an area: type, callsign, operator "
        "where known, position, altitude and speed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 300,
                    "default": 100,
                }
            }
            | AREA,
        },
    },
    {
        "name": "ships",
        "description": "Ships reporting by AIS in an area (needs the "
        "server's AIS key): name, type, flag, position, speed, heading.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 300,
                    "default": 100,
                }
            }
            | AREA,
            "required": ["west", "south", "east", "north"],
        },
    },
    {
        "name": "traffic_cameras",
        "description": "Government traffic cameras in an area (about a "
        "state or smaller): name, road, place, agency and the way each "
        "looks.",
        "inputSchema": {
            "type": "object",
            "properties": dict(AREA),
            "required": ["west", "south", "east", "north"],
        },
    },
    {
        "name": "news",
        "description": "Latest headlines from the news feeds Argus "
        "follows, optionally matching words.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 30,
                },
            },
        },
    },
]
for tool in TOOLS:
    tool["annotations"] = READ_ONLY


def _bbox(args: dict) -> str | None:
    keys = ("west", "south", "east", "north")
    if not all(isinstance(args.get(k), (int, float)) for k in keys):
        return None
    return ",".join("{0:.4f}".format(float(args[k])) for k in keys)


def _first(value: Any, limit: int) -> Any:
    """Long lists cut to limit, anywhere in the answer."""
    if isinstance(value, list):
        return [_first(v, limit) for v in value[:limit]]
    if isinstance(value, dict):
        return {k: _first(v, limit) for k, v in value.items()}
    return value


async def _call(api: httpx.AsyncClient, name: str, args: dict) -> Any:
    async def get(path: str, **params) -> Any:
        r = await api.get(
            path, params={k: v for k, v in params.items() if v is not None}
        )
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except ValueError:
                detail = None
            raise ToolError(
                detail or "Argus answered {0}".format(r.status_code)
            )
        return r.json()

    if name == "get_situation":
        hours = int(args.get("hours") or 24)
        summary = await get("/api/summary", hours=hours)
        tension = await get("/api/tension")
        return {"summary": summary, "tension": _first(tension, 15)}
    if name == "list_events":
        limit = int(args.get("limit") or 40)
        body = await get(
            "/api/events",
            hours=int(args.get("hours") or 24),
            types=args.get("types"),
            min_severity=int(args.get("min_severity") or 2),
            bbox=_bbox(args),
            limit=limit,
        )
        return _first(body, limit)
    if name == "search":
        return _first(await get("/api/search", q=str(args["query"])), 20)
    if name == "weather_at":
        lat, lon = float(args["lat"]), float(args["lon"])
        forecast = await get("/api/weather/forecast", lat=lat, lon=lon)
        air = await get("/api/weather/air/here", lat=lat, lon=lon)
        return {"weather": forecast, "air_quality": air}
    if name == "military_aircraft":
        limit = int(args.get("limit") or 100)
        body = await get("/api/aircraft", civil="false", bbox=_bbox(args))
        return _first(body, limit)
    if name == "ships":
        limit = int(args.get("limit") or 100)
        body = await get("/api/vessels", bbox=_bbox(args), limit=limit)
        return _first(body, limit)
    if name == "traffic_cameras":
        body = await get("/api/cams", bbox=_bbox(args))
        return _first(body, 200)
    if name == "news":
        return await get(
            "/api/news",
            q=args.get("query") or None,
            limit=int(args.get("limit") or 30),
        )
    raise ToolError("No tool called {0}.".format(name))


class ToolError(Exception):
    pass


def _result(mid: Any, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _error(mid: Any, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": mid,
        "error": {"code": code, "message": message},
    }


async def _handle(msg: Any, api: httpx.AsyncClient) -> dict | None:
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return _error(None, -32600, "Not a JSON-RPC 2.0 message.")
    method = msg.get("method")
    mid = msg.get("id")
    if method is None or mid is None:
        # A notification (or a response to us): nothing to answer.
        return None
    params = msg.get("params") or {}
    if method == "initialize":
        asked = params.get("protocolVersion")
        return _result(
            mid,
            {
                "protocolVersion": asked
                if asked in PROTOCOLS
                else PROTOCOLS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "argus", "version": __version__},
                "instructions": INSTRUCTIONS,
            },
        )
    if method == "ping":
        return _result(mid, {})
    if method == "tools/list":
        return _result(mid, {"tools": TOOLS})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            data = await _call(api, str(name), args)
        except (ToolError, KeyError, TypeError, ValueError) as exc:
            return _result(
                mid,
                {
                    "content": [{"type": "text", "text": str(exc)}],
                    "isError": True,
                },
            )
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(text) > MAX_TEXT:
            text = text[:MAX_TEXT] + " …(cut; ask for a smaller area)"
        return _result(mid, {"content": [{"type": "text", "text": text}]})
    return _error(mid, -32601, "No method {0}.".format(method))


def _origin_ok(request: Request) -> bool:
    """Browsers send Origin; only this site's own may call (DNS
    rebinding). Assistants and scripts send none."""
    origin = request.headers.get("origin")
    if not origin:
        return True
    host = request.headers.get("host", "")
    return origin.split("://", 1)[-1] == host


@router.post("/api/mcp")
async def mcp(request: Request):
    if not _origin_ok(request):
        return JSONResponse({"error": "Origin not allowed."}, status_code=403)
    auth = request.headers.get("authorization", "")
    async with request.app.state.db.sessionmaker() as db:
        session = await token_session(db, auth)
    if session is None:
        return JSONResponse(
            {"error": "An Argus API token is needed (Settings > Account)."},
            status_code=401,
            headers={"WWW-Authenticate": 'Bearer realm="argus"'},
        )
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse(_error(None, -32700, "Not JSON."), 400)
    api = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=request.app),
        base_url="http://argus.internal",
        headers={"Authorization": auth},
        timeout=60,
    )
    async with api:
        if isinstance(body, list):
            out = [r for r in [await _handle(m, api) for m in body] if r]
        else:
            out = await _handle(body, api)
    if not out:
        return Response(status_code=202)
    return JSONResponse(out)


@router.get("/api/mcp")
async def mcp_stream():
    # No server-initiated messages: no event stream to open.
    return Response(status_code=405, headers={"Allow": "POST"})
