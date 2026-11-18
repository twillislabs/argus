---
title: Data pipeline (planned)
sidebar_position: 7
---

# Data pipeline

:::note Planned
This is the design for milestones 1–6. Today only the account and preference
paths exist. This page is kept up to date as each part lands.
:::

```mermaid
flowchart LR
  subgraph sources[External sources]
    adsb[adsb.lol / airplanes.live]
    ais[AISStream]
    celestrak[CelesTrak]
    gdelt[GDELT / RSS]
    usgs[USGS / FIRMS / NWS]
    yt[YouTube Data API]
  end
  subgraph collectors[collectors container]
    c1[one module per source<br/>poll or stream, normalise]
  end
  subgraph bus[NATS JetStream]
    s1[(pos.air, pos.sea)]
    s2[(raw.event.*)]
    s3[(media.*)]
  end
  subgraph consumers
    live[live-state<br/>latest positions in memory]
    persist[persister<br/>TimescaleDB]
    fusion[fusion / patterns<br/>events, tension, alerts]
  end
  db[(PostgreSQL)]
  api[FastAPI]
  browser[Browser]
  sources --> c1 --> s1 & s2 & s3
  s1 --> live & persist
  s2 & s3 --> fusion
  persist & fusion --> db
  live -->|bbox queries, diffs| api
  db --> api
  api -->|REST + WebSocket /ws/live| browser
```

## Stages

1. **Collect.** Each source has a collector module that knows its API, rate
   limits and licence. It converts records to Argus schemas (`Position`,
   `RawEvent`, `MediaItem`) and publishes them to NATS subjects.
2. **Live state.** Consumes positions and keeps the latest state per entity
   in memory, answering "everything in this bounding box now" quickly. It
   publishes diffs to connected browsers over `/ws/live`.
3. **Persist.** Writes positions to a TimescaleDB hypertable (full rate for 7
   days, downsampled for 90) and raw records for 30 days. This is what replay
   reads.
4. **Fuse.** Clusters raw records into events (same type, within 25 km and
   2 h), scores severity (1–5) and confidence, attaches media and articles,
   detects patterns (orbits, tanker surges, AIS gaps, GPS interference) and
   updates the tension index.
5. **Alert.** Matches new and updated events against geofences, watchlists
   and rules, then notifies through the flash banner, wall mode, ntfy, email
   or webhooks.
6. **Serve.** The API answers map queries (bbox + layers + time), entity and
   event detail, search, and pushes live updates.

## Why a bus

AIS and ADS-B produce thousands of messages per second. NATS decouples
collectors from consumers: a slow database never blocks collection, a
collector can be restarted without losing consumers, and JetStream can
replay recent messages after a restart.
