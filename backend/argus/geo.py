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


def simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    """Ramer-Douglas-Peucker in plain lon/lat degrees: drop points closer
    than `tolerance` to the line between their neighbours."""
    if len(points) < 3:
        return points

    def dist(p, a, b) -> float:
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return math.hypot(x - x1, y - y1)
        t = max(
            0.0,
            min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
        )
        return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        best, index = 0.0, -1
        for i in range(first + 1, last):
            d = dist(points[i], points[first], points[last])
            if d > best:
                best, index = d, i
        if index >= 0 and best > tolerance:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [p for p, k in zip(points, keep, strict=True) if k]
