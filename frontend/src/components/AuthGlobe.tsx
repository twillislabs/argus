import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

// The sign-in page's globe: Natural Earth countries (bundled, 110m) on a
// slowly turning orthographic globe, with a graticule, an atmosphere and
// a few lit cities. Drawn on a canvas; no tiles, no data from the API,
// so it works before anyone signs in. Still for reduced motion.

const DEG = Math.PI / 180;
const TILT = 18 * DEG; // look down a little on the northern hemisphere
const SPIN = 4; // degrees a second
// Big cities, lit like the watch floor's markers.
const CITIES: [number, number][] = [
  [-74, 40.7],
  [-0.1, 51.5],
  [2.35, 48.86],
  [37.6, 55.75],
  [139.7, 35.7],
  [116.4, 39.9],
  [77.2, 28.6],
  [31.2, 30.05],
  [-46.6, -23.5],
  [151.2, -33.9],
  [28.98, 41.0],
  [55.3, 25.2],
  [-118.2, 34.05],
  [-86.8, 36.16],
  [30.5, 50.45],
  [103.8, 1.35],
  [3.4, 6.5],
  [-99.1, 19.4],
];
const ALERTS: [number, number][] = [
  [34.45, 31.5],
  [37.8, 48.0],
  [44.4, 33.3],
  [32.5, 15.6],
];

type Ring = number[][];

export default function AuthGlobe() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let land: Ring[][] = [];
    let borders: Ring[] = [];
    let frame = 0;
    let stopped = false;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const start = performance.now();

    void fetch('/data/countries-110m.json')
      .then((r) => (r.ok ? (r.json() as Promise<Topology>) : null))
      .then((topo) => {
        if (!topo || stopped) return;
        const countries = topo.objects.countries as GeometryCollection;
        const fc = feature(topo, countries) as unknown as GeoJSON.FeatureCollection;
        for (const f of fc.features) {
          const g = f.geometry;
          if (!g) continue;
          if (g.type === 'Polygon') land.push(g.coordinates as Ring[]);
          else if (g.type === 'MultiPolygon') land.push(...(g.coordinates as Ring[][]));
        }
        const lines = mesh(topo, countries, (a, b) => a !== b) as unknown as GeoJSON.MultiLineString;
        borders = lines.coordinates as Ring[];
      })
      .catch(() => undefined);

    function draw(now: number) {
      if (stopped || !el || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = Math.min(w, h) * 0.42;
      const cx = w / 2;
      const cy = h * 0.46;
      const lon0 = (still ? 20 : 20 - ((now - start) / 1000) * SPIN) * DEG;
      const sinT = Math.sin(TILT);
      const cosT = Math.cos(TILT);

      // Orthographic projection; z > 0 is the near side. Far-side points
      // are pushed out to the limb so filled shapes stay closed.
      const project = (lon: number, lat: number): [number, number, number] => {
        const l = lon * DEG + lon0;
        const p = lat * DEG;
        const x = Math.cos(p) * Math.sin(l);
        const y0 = Math.sin(p);
        const z0 = Math.cos(p) * Math.cos(l);
        const y = y0 * cosT - z0 * sinT;
        const z = y0 * sinT + z0 * cosT;
        return [x, y, z];
      };
      const toScreen = (x: number, y: number, z: number): [number, number] => {
        if (z < 0) {
          const k = 1 / Math.hypot(x, y || 1e-9);
          return [cx + x * k * r, cy - y * k * r];
        }
        return [cx + x * r, cy - y * r];
      };

      // Atmosphere and ocean.
      const glow = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.22);
      glow.addColorStop(0, 'rgba(91, 155, 255, 0.28)');
      glow.addColorStop(1, 'rgba(91, 155, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.22, 0, 2 * Math.PI);
      ctx.fill();
      const sea = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      sea.addColorStop(0, '#132033');
      sea.addColorStop(1, '#070b11');
      ctx.fillStyle = sea;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.clip();

      // Graticule every 15 degrees, near side only.
      ctx.strokeStyle = 'rgba(120, 150, 190, 0.12)';
      ctx.lineWidth = 0.8;
      const line = (pts: [number, number][]) => {
        let down = false;
        ctx.beginPath();
        for (const [lon, lat] of pts) {
          const [x, y, z] = project(lon, lat);
          if (z < 0) {
            down = false;
            continue;
          }
          const [sx, sy] = toScreen(x, y, z);
          if (down) ctx.lineTo(sx, sy);
          else ctx.moveTo(sx, sy);
          down = true;
        }
        ctx.stroke();
      };
      for (let lon = -180; lon < 180; lon += 15) {
        const pts: [number, number][] = [];
        for (let lat = -90; lat <= 90; lat += 3) pts.push([lon, lat]);
        line(pts);
      }
      for (let lat = -75; lat <= 75; lat += 15) {
        const pts: [number, number][] = [];
        for (let lon = -180; lon <= 180; lon += 3) pts.push([lon, lat]);
        line(pts);
      }

      // Land: only polygons with some part on the near side.
      ctx.fillStyle = '#1a2230';
      for (const poly of land) {
        let near = false;
        ctx.beginPath();
        for (const ring of poly) {
          ring.forEach(([lon, lat], i) => {
            const [x, y, z] = project(lon, lat);
            if (z > 0) near = true;
            const [sx, sy] = toScreen(x, y, z);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
          });
          ctx.closePath();
        }
        if (near) ctx.fill('evenodd');
      }
      ctx.strokeStyle = 'rgba(140, 170, 210, 0.35)';
      ctx.lineWidth = 0.7;
      for (const b of borders) line(b as [number, number][]);

      // Lit cities and a few alerts, pulsing.
      const t = (now - start) / 1000;
      const dot = (lon: number, lat: number, color: string, size: number, pulse: number) => {
        const [x, y, z] = project(lon, lat);
        if (z < 0.05) return;
        const [sx, sy] = toScreen(x, y, z);
        const fade = Math.min(1, z * 3);
        if (pulse) {
          const k = (t * 0.6 + pulse) % 1;
          ctx.strokeStyle = color.replace('A', String((1 - k) * 0.7 * fade));
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, size + k * 14, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.fillStyle = color.replace('A', String(0.95 * fade));
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 2 * Math.PI);
        ctx.fill();
      };
      for (const [lon, lat] of CITIES) dot(lon, lat, 'rgba(140, 200, 255, A)', 1.8, 0);
      ALERTS.forEach(([lon, lat], i) => dot(lon, lat, 'rgba(255, 82, 96, A)', 2.6, still ? 0 : i * 0.25 + 0.1));

      // Light from the upper left.
      const shade = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.2, cx, cy, r * 1.05);
      shade.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
      ctx.fillStyle = shade;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      ctx.restore();

      ctx.strokeStyle = 'rgba(91, 155, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();

      if (!still) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    // With reduced motion, draw again once the shapes arrive.
    const again = still ? window.setTimeout(() => requestAnimationFrame(draw), 800) : undefined;
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(again);
    };
  }, []);

  return <canvas ref={canvas} className="auth-globe-canvas" />;
}
