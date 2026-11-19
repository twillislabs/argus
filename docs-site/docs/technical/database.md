---
title: Database
sidebar_position: 6
---

# Database

PostgreSQL 17 with TimescaleDB and PostGIS available (from the
`timescaledb-ha` image). M0 only uses plain tables; hypertables and spatial
columns arrive with the data layers.

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

## Planned tables

| Table | Milestone | Purpose |
|---|---|---|
| `entity` | M1–M3 | Aircraft, vessels, satellites, facilities |
| `position` (hypertable) | M2 | Time-stamped positions with PostGIS geometry |
| `raw_record` | M1 | Every record a source returned, kept for 30 days |
| `event`, `event_source` | M1 | Fused events and their source records |
| `media`, `article` | M5 | Event media and news coverage |
| `pattern` | M5 | Detected behaviour |
| `geofence`, `watch`, `alert_rule`, `alert` | M6 | Alerting |
