// Small spherical-earth helpers for drawing, measuring and selecting.

export type LonLat = [number, number];

const R = 6371.0088; // km, mean radius
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(a: LonLat, b: LonLat): number {
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathKm(points: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceKm(points[i - 1], points[i]);
  return total;
}

// A circle as a ring of points (closed).
export function circleRing(centre: LonLat, radiusKm: number, steps = 72): LonLat[] {
  const out: LonLat[] = [];
  const d = radiusKm / R;
  const lat1 = rad(centre[1]);
  const lon1 = rad(centre[0]);
  for (let i = 0; i <= steps; i++) {
    const brg = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 =
      lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push([((deg(lon2) + 540) % 360) - 180, deg(lat2)]);
  }
  return out;
}

// A rectangle from two opposite corners, as a closed ring.
export function rectRing(a: LonLat, b: LonLat): LonLat[] {
  return [a, [b[0], a[1]], b, [a[0], b[1]], a];
}

// Ray casting in lon/lat (fine for areas that don't cross the date line).
export function inRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Approximate area of a ring in km² (spherical excess).
export function ringAreaKm2(ring: LonLat[]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    total += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((total * R * R) / 2);
}

// Points every ~stepKm along the great circles between points, so long
// lines follow the earth's surface instead of cutting under it.
export function densify(points: LonLat[], stepKm = 40): LonLat[] {
  if (points.length < 2) return points;
  const out: LonLat[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = distanceKm(a, b);
    const n = Math.min(200, Math.floor(d / stepKm));
    const p1 = [rad(a[0]), rad(a[1])];
    const p2 = [rad(b[0]), rad(b[1])];
    const delta = d / R;
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      const A = Math.sin((1 - f) * delta) / Math.sin(delta);
      const B = Math.sin(f * delta) / Math.sin(delta);
      const x = A * Math.cos(p1[1]) * Math.cos(p1[0]) + B * Math.cos(p2[1]) * Math.cos(p2[0]);
      const y = A * Math.cos(p1[1]) * Math.sin(p1[0]) + B * Math.cos(p2[1]) * Math.sin(p2[0]);
      const z = A * Math.sin(p1[1]) + B * Math.sin(p2[1]);
      out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
    }
    out.push(b);
  }
  return out;
}
