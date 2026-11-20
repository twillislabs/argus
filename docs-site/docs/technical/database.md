---
title: Database
sidebar_position: 6
---

# Database

PostgreSQL 17 with TimescaleDB and PostGIS available (from the
`timescaledb-ha` image). Argus uses plain tables; the diagram shows the
accounts side, and the tables below cover the rest.

```mermaid
erDiagram
  users ||--o| user_preferences : has
  users ||--o{ user_sessions : "signs in with"
  users ||--o{ audit_log : "acts in"
  users {
    int id PK
    string username UK "lower-case"
    string display_name
    string email "nullable"
    string password_hash "Argon2id"
    string role "admin | analyst | viewer | display"
    bool is_active
    timestamptz created_at
    timestamptz last_login_at
    int failed_logins
    timestamptz locked_until
  }
  user_preferences {
    int user_id PK,FK
    json data "home, basemap, panels, layers"
    timestamptz updated_at
  }
  user_sessions {
    string id PK "SHA-256 of cookie token"
    int user_id FK
    string csrf_token
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz expires_at
    bool remember
    string user_agent
    string ip
  }
  setup_tokens {
    int id PK
    string token_hash "SHA-256"
    timestamptz created_at
    timestamptz expires_at
    timestamptz used_at
  }
  audit_log {
    int id PK
    timestamptz at
    int user_id FK "nullable"
    string action
    string ip
    json detail
  }
```

All timestamps are stored as `timestamptz` in UTC.

`tension_daily` (day, area, total, samples) holds the tension index's
hourly samples summed per day: `area` is a country name, `theatre:<id>`
or `world`. The baseline is `sum(total) / sum(world samples)` over the 90
days before today; rows older than that are pruned.

## Other tables

| Table | Holds |
|---|---|
| `sources` | Each collector's last run, last success, count and error (the Sources health table) |
| `raw_records` | Every record a source returned (trimmed), kept 30 days |
| `events`, `event_sources` | Fused events and the raw records behind them |
| `articles` | News headlines: headline, excerpt and link only |
| `server_settings` | Server-wide settings and layers kept by the worker (`keys`, `defaults`, `ai`, `layer:*` and so on); secrets in them are encrypted |
| `satellites` | The CelesTrak catalogue (orbital elements) |
| `tension_daily` | The tension index's daily totals (below) |
| `nws_zones` | NWS forecast zone outlines, for zone-based alerts |
| `alpr_tiles` | Plate reader cameras per 1° tile from OpenStreetMap, kept a week |
| `alert_rules`, `alert_channels`, `alerts` | Each user's alert rules, delivery settings (ntfy topic and webhook URL encrypted) and the alerts that fired, unique per rule and key |

Users' child rows (preferences, sessions, alert rules and channels,
alerts) are deleted with the user by `ON DELETE CASCADE`.
