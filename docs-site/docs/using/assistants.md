---
title: AI assistants (MCP)
---

# AI assistants (MCP)

Argus has an [MCP](https://modelcontextprotocol.io/) server, so an AI
assistant that speaks MCP (Claude Code, Claude Desktop and others) can
read what Argus shows you and answer questions about it: "what's
happening near home?", "any strong earthquakes today?", "military
aircraft over the Baltic?".

## Make a token

In **Settings › AI assistants**, name a token for where it'll be used
and press **Make token**. Copy it straight away: Argus keeps only a
fingerprint of it and can't show it again. **Revoke** stops it at once.

A token is read-only. It can read map data (events, the situation,
search, weather and air quality, aircraft, ships, traffic cameras and
news) as your account sees it, and nothing else: no accounts, settings,
admin pages or backups, and it can't change anything. Each person can
have up to 10. Wall screens can't have tokens.

## Connect

The server is at `https://<your Argus>/api/mcp` (MCP's Streamable HTTP
transport). Settings › AI assistants shows both of these with your
address and new token filled in.

**Claude Code:**

```bash
claude mcp add --transport http argus https://argus.example.com/api/mcp --header "Authorization: Bearer argus_..."
```

**Claude Desktop** and other apps that run local servers, through
[mcp-remote](https://www.npmjs.com/package/mcp-remote), in the app's MCP
config:

```json
{
  "mcpServers": {
    "argus": {
      "command": "npx",
      "args": ["mcp-remote", "https://argus.example.com/api/mcp", "--header", "Authorization: Bearer argus_..."]
    }
  }
}
```

## Tools

| Tool | What it reads |
|---|---|
| `get_situation` | The tension score and band, the top countries, and events by type over the last hours |
| `list_events` | Recent events, newest first, optionally for an area (`west`, `south`, `east`, `north`), some types and a minimum severity |
| `search` | Places, flights, ships, satellites and events by name |
| `weather_at` | A spot's weather now, by the hour and by the day, and its air quality |
| `military_aircraft` | Military aircraft broadcasting now, worldwide or in an area |
| `ships` | Ships reporting by AIS in an area (needs the server's AIS key) |
| `traffic_cameras` | Government traffic cameras in an area |
| `news` | Latest headlines, optionally matching words |

What a tool reads goes to the assistant's provider, like anything else
in that conversation. The data comes from public sources and can be
wrong or late.
