---
slug: /
title: Introduction
---

# Argus

Argus is a self-hosted visualizer for open-source intelligence (OSINT). It puts
aircraft, ships, satellites, events, airspace, infrastructure, weather and live
video on one map that zooms from the whole globe to street level.

The source code, releases and issue tracker are on GitHub:
[github.com/twillislabs/argus](https://github.com/twillislabs/argus).

:::info Status
Argus is in regular use, with tagged releases (see the
[changelog](https://github.com/twillislabs/argus/blob/main/CHANGELOG.md)).
It has live events, aircraft, ships, satellites, airspace, weather,
cameras, news and video, a Brief page, wall displays, alerts and
optional AI features.
:::

## Principles

- **Self-hosted.** Everything runs from one `docker compose up`. Core layers
  need no paid keys.
- **Overview first, then the details.** A situation summary answers "what
  changed?", and every marker links to its sources.
- **Provenance always.** Each item shows where it came from and how fresh it is.
- **AI is optional** and can run on your own hardware.

## Where to next

- [Install with Docker Compose](getting-started/install.md)
- [First-run setup](getting-started/first-run.md)
- [Security model](admin/security.md)
- [How it all connects](technical/overview.md)
