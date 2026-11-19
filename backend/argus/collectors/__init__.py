"""Data-source collectors. One module per source."""

from argus.collectors.airspace import (
    CzibCollector,
    SigmetCollector,
    TfrCollector,
)
from argus.collectors.base import (
    Collector,
    CollectResult,
    RawIn,
    SourceError,
)
from argus.collectors.firms import FirmsCollector
from argus.collectors.gdelt import GdeltCollector
from argus.collectors.hazards import (
    EonetCollector,
    GdacsCollector,
    TsunamiCollector,
)
from argus.collectors.nga import NgaCollector
from argus.collectors.rss import RssCollector
from argus.collectors.usgs import UsgsCollector
from argus.collectors.weather import NwsCollector, SpcCollector

REGISTRY: dict[str, type[Collector]] = {
    c.name: c
    for c in (
        UsgsCollector,
        GdeltCollector,
        RssCollector,
        FirmsCollector,
        GdacsCollector,
        EonetCollector,
        TsunamiCollector,
        NgaCollector,
        TfrCollector,
        SigmetCollector,
        CzibCollector,
        NwsCollector,
        SpcCollector,
    )
}

__all__ = [
    "REGISTRY",
    "CollectResult",
    "Collector",
    "RawIn",
    "SourceError",
]
