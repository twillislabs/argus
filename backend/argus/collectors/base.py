"""Collector interface shared by every data source."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from argus.config import Settings


@dataclass
class RawIn:
    """One record from a source, before it is stored."""

    source: str
    external_id: str
    kind: str  # 'quake', 'gdelt', 'fire_cluster', 'article'
    observed_at: datetime
    lat: float | None = None
    lon: float | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class CollectResult:
    records: list[RawIn]
    # New progress marker to store; None keeps the old one.
    cursor: str | None = None
    # Parts of the source that failed (e.g. individual feeds).
    failures: list[str] = field(default_factory=list)


class SourceError(Exception):
    """A source failed in a way worth showing in source health."""


class Collector:
    """Subclasses set the class attributes and implement collect()."""

    name: str = ""
    label: str = ""
    interval_s: int = 300
    licence: str = ""
    terms_url: str = ""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def enabled(self) -> bool:
        return True

    async def collect(
        self, client: httpx.AsyncClient, cursor: str | None
    ) -> CollectResult:
        raise NotImplementedError
