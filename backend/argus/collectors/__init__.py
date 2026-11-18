"""Data-source collectors. One module per source."""

from argus.collectors.base import (
    Collector,
    CollectResult,
    RawIn,
    SourceError,
)
from argus.collectors.firms import FirmsCollector
from argus.collectors.gdelt import GdeltCollector
from argus.collectors.rss import RssCollector
from argus.collectors.usgs import UsgsCollector

REGISTRY: dict[str, type[Collector]] = {
    c.name: c
    for c in (UsgsCollector, GdeltCollector, RssCollector, FirmsCollector)
}

__all__ = [
    "REGISTRY",
    "CollectResult",
    "Collector",
    "RawIn",
    "SourceError",
]
