"""Small geographic helpers."""

import math

EARTH_KM = 6371.0


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = (
        math.sin(dp / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def degrees_box(lat: float, km: float) -> tuple[float, float]:
    """Half-sizes in degrees (lat, lon) of a box km across from centre."""
    dlat = km / 111.32
    dlon = km / max(1e-6, 111.32 * math.cos(math.radians(lat)))
    return dlat, min(180.0, dlon)
