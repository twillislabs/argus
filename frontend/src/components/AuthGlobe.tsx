import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

import { currentTheme, type Theme } from '../lib/themes';

// The sign-in page's globe: Natural Earth countries (bundled, 110m) on a
// slowly turning orthographic globe, with a graticule, an atmosphere, a
// starfield, the real day and night (the Sun's position now), a few lit
// cities and alerts, flight arcs tracing between cities, satellites on
// their orbits and a slow radar sweep. Drawn on a canvas; no tiles, no
// data from the API, so it works before anyone signs in. Still for
// reduced motion.

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
  [-87.63, 41.88],
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

// Flights traced between cities (indexes into CITIES), each on its own
// clock so they don't all start together.
const ROUTES: [number, number][] = [
  [0, 1],
  [1, 4],
  [12, 4],
  [2, 9],
  [5, 6],
  [7, 11],
  [3, 5],
  [8, 2],
  [13, 1],
  [15, 6],
];
const ROUTE_S = 7; // seconds a flight takes to draw
// Satellite orbits: inclination, ascending node, height (globe radii) and
// seconds per orbit.
const ORBITS: [number, number, number, number][] = [
  [51.6, 20, 1.12, 26],
  [98, 140, 1.16, 34],
  [28, 250, 1.2, 44],
];

// Where the Sun is overhead now (degrees), close enough for shading.
function subsolar(date: Date): [number, number] {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86_400_000;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return [-(hours - 12) * 15, decl];
}

// A fixed starfield (positions 0..1 across the canvas).
const STARS = Array.from({ length: 170 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1), y: r(2), a: 0.15 + r(3) * 0.55, size: r(4) < 0.9 ? 0.7 : 1.3, tw: r(5) * 6.28 };
});

type Ring = number[][];

// A CSS colour as r, g, b (the browser parses it), cached.
const parsed = new Map<string, [number, number, number]>();
const probe = document.createElement('canvas').getContext('2d');
function rgbOf(css: string): [number, number, number] {
  const hit = parsed.get(css);
  if (hit) return hit;
  let out: [number, number, number] = [128, 160, 200];
  if (probe) {
    probe.fillStyle = '#000';
    probe.fillStyle = css;
    const v = String(probe.fillStyle);
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(v);
    const fn = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (hex) out = [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
    else if (fn) out = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  }
  parsed.set(css, out);
  return out;
}
const withAlpha = (css: string) => {
  const [r, g, b] = rgbOf(css);
  return (a: number) => 'rgba(' + r + ', ' + g + ', ' + b + ', ' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
};

// The theme's colours for the globe (lib/themes.ts).
function palette(t: Theme) {
  const [r, g, b] = rgbOf(t.map.ocean);
  const lift = (v: number) => Math.min(255, Math.round(v + 22));
  return {
    accent: withAlpha(t.colors.accent),
    crit: withAlpha(t.colors.crit),
    high: withAlpha(t.colors.high),
    elev: withAlpha(t.colors.elev),
    ok: withAlpha(t.colors.ok),
    ocean: t.map.ocean,
    oceanLit: 'rgb(' + lift(r) + ', ' + lift(g) + ', ' + lift(b) + ')',
    land: t.map.land,
    border: t.map.coast,
    graticule: t.map.graticule,
  };
}

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
    // Night side, drawn small and stretched over the disc (soft edge).
    const NIGHT_PX = 120;
    const night = document.createElement('canvas');
    night.width = night.height = NIGHT_PX;
    const nctx = night.getContext('2d');
    const nimg = nctx?.createImageData(NIGHT_PX, NIGHT_PX);

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
      // The globe is the page's background: on a wide page it sits left
      // of centre, away from the form on the right; on a tall phone page
      // it sits up top, behind the name, with the form below.
      const tall = h > w * 1.15;
      const r = tall ? w * 0.62 : Math.min(w * 0.3, h * 0.44);
      const cx = tall ? w / 2 : w * 0.34;
      const cy = tall ? h * 0.3 : h * 0.5;
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

      const t = (now - start) / 1000;
      const C = palette(currentTheme());

      // Stars behind everything.
      for (const st of STARS) {
        const tw = still ? 1 : 0.65 + 0.35 * Math.sin(t * 1.3 + st.tw);
        ctx.fillStyle = 'rgba(200, 220, 255, ' + (st.a * tw).toFixed(3) + ')';
        ctx.fillRect(st.x * w, st.y * h, st.size, st.size);
      }

      // Atmosphere and ocean.
      const glow = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.22);
      glow.addColorStop(0, C.accent(0.28));
      glow.addColorStop(1, C.accent(0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.22, 0, 2 * Math.PI);
      ctx.fill();
      const sea = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      sea.addColorStop(0, C.oceanLit);
      sea.addColorStop(1, C.ocean);
      ctx.fillStyle = sea;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.clip();

      // Graticule every 15 degrees, near side only.
      ctx.strokeStyle = C.graticule;
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
      ctx.fillStyle = C.land;
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
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 0.7;
      for (const b of borders) line(b as [number, number][]);

      // Night: the hemisphere facing away from the Sun, darker, with a
      // soft terminator.
      const [sLon, sLat] = subsolar(new Date());
      const sun = project(sLon, sLat);
      if (nctx && nimg) {
        const d = nimg.data;
        for (let j = 0; j < NIGHT_PX; j++) {
          for (let i = 0; i < NIGHT_PX; i++) {
            const x = (i + 0.5) / (NIGHT_PX / 2) - 1;
            const y = 1 - (j + 0.5) / (NIGHT_PX / 2);
            const q = x * x + y * y;
            const k = (j * NIGHT_PX + i) * 4;
            if (q > 1) {
              d[k + 3] = 0;
              continue;
            }
            const z = Math.sqrt(1 - q);
            const lit = x * sun[0] + y * sun[1] + z * sun[2];
            const a = Math.min(1, Math.max(0, (0.12 - lit) / 0.3));
            d[k] = 2;
            d[k + 1] = 4;
            d[k + 2] = 10;
            d[k + 3] = Math.round(a * 150);
          }
        }
        nctx.putImageData(nimg, 0, 0);
        ctx.drawImage(night, cx - r, cy - r, 2 * r, 2 * r);
      }

      // Flights tracing great circles between cities, lifted off the
      // ground in the middle, a bright head and a fading tail.
      if (!still) {
        ROUTES.forEach(([a, b], n) => {
          const phase = ((t + n * 2.3) / ROUTE_S) % 1.5;
          if (phase > 1.15) return;
          const [lo1, la1] = CITIES[a];
          const [lo2, la2] = CITIES[b];
          const v = (lon: number, lat: number) => [
            Math.cos(lat * DEG) * Math.cos(lon * DEG),
            Math.cos(lat * DEG) * Math.sin(lon * DEG),
            Math.sin(lat * DEG),
          ];
          const p1 = v(lo1, la1);
          const p2 = v(lo2, la2);
          const omega = Math.acos(Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]));
          if (omega < 0.01) return;
          const head = Math.min(1, phase);
          const tail = Math.max(0, phase - 0.45);
          const steps = 28;
          let prev: [number, number] | null = null;
          for (let i = 0; i <= steps; i++) {
            const f = tail + ((head - tail) * i) / steps;
            const s1 = Math.sin((1 - f) * omega) / Math.sin(omega);
            const s2 = Math.sin(f * omega) / Math.sin(omega);
            const q = [s1 * p1[0] + s2 * p2[0], s1 * p1[1] + s2 * p2[1], s1 * p1[2] + s2 * p2[2]];
            const lat = Math.asin(q[2]) / DEG;
            const lon = Math.atan2(q[1], q[0]) / DEG;
            const lift = 1 + 0.1 * Math.sin(Math.PI * f) * Math.min(1, omega);
            const [x, y, z] = project(lon, lat);
            const visible = z > 0;
            const sx = cx + x * lift * r;
            const sy = cy - y * lift * r;
            if (prev && visible) {
              const alpha = (i / steps) * 0.85 * Math.min(1, (1.15 - phase) * 4);
              ctx.strokeStyle = C.high(alpha);
              ctx.lineWidth = 1.3;
              ctx.beginPath();
              ctx.moveTo(prev[0], prev[1]);
              ctx.lineTo(sx, sy);
              ctx.stroke();
            }
            prev = visible ? [sx, sy] : null;
            if (i === steps && visible && phase <= 1) {
              ctx.fillStyle = C.elev(0.95);
              ctx.beginPath();
              ctx.arc(sx, sy, 1.8, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        });
      }

      // Lit cities and a few alerts, pulsing.
      const dot = (lon: number, lat: number, color: (a: number) => string, size: number, pulse: number) => {
        const [x, y, z] = project(lon, lat);
        if (z < 0.05) return;
        const [sx, sy] = toScreen(x, y, z);
        const fade = Math.min(1, z * 3);
        if (pulse) {
          const k = (t * 0.6 + pulse) % 1;
          ctx.strokeStyle = color((1 - k) * 0.7 * fade);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, size + k * 14, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.fillStyle = color(0.95 * fade);
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 2 * Math.PI);
        ctx.fill();
      };
      for (const [lon, lat] of CITIES) dot(lon, lat, C.accent, 1.8, 0);
      ALERTS.forEach(([lon, lat], i) => dot(lon, lat, C.crit, 2.6, still ? 0 : i * 0.25 + 0.1));

      // Light from the upper left.
      const shade = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.2, cx, cy, r * 1.05);
      shade.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
      ctx.fillStyle = shade;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      ctx.restore();

      ctx.strokeStyle = C.accent(0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();

      // Satellites on their orbits: a faint path, hidden behind the
      // globe, and a dot with a short trail.
      ORBITS.forEach(([inc, node, k, period], n) => {
        const pos = (u: number): [number, number, boolean] => {
          const lat = Math.asin(Math.sin(inc * DEG) * Math.sin(u)) / DEG;
          const lon = node + Math.atan2(Math.cos(inc * DEG) * Math.sin(u), Math.cos(u)) / DEG;
          const [x, y, z] = project(lon, lat);
          const sx = cx + x * k * r;
          const sy = cy - y * k * r;
          const hidden = z < 0 && Math.hypot(x * k, y * k) < 1;
          return [sx, sy, !hidden];
        };
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = C.ok(0.16);
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        let down = false;
        for (let i = 0; i <= 120; i++) {
          const [sx, sy, vis] = pos((i / 120) * 2 * Math.PI);
          if (!vis) {
            down = false;
            continue;
          }
          if (down) ctx.lineTo(sx, sy);
          else ctx.moveTo(sx, sy);
          down = true;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const u = ((still ? n * 2 : t) / period) * 2 * Math.PI + n * 2.1;
        for (let i = 8; i >= 0; i--) {
          const [sx, sy, vis] = pos(u - i * 0.025);
          if (!vis) continue;
          ctx.fillStyle = C.ok(i === 0 ? 1 : (1 - i / 9) * 0.45);
          ctx.beginPath();
          ctx.arc(sx, sy, i === 0 ? 2.4 : 1.4, 0, 2 * Math.PI);
          ctx.fill();
        }
      });

      // A slow radar sweep over the disc.
      if (!still && 'createConicGradient' in ctx) {
        const angle = (t * 0.5) % (2 * Math.PI);
        const sweep = ctx.createConicGradient(angle - 0.09 * 2 * Math.PI, cx, cy);
        // Faint behind, brightest at the leading edge.
        sweep.addColorStop(0, C.accent(0));
        sweep.addColorStop(0.09, C.accent(0.11));
        sweep.addColorStop(0.0905, C.accent(0));
        sweep.addColorStop(1, C.accent(0));
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.clip();
        ctx.fillStyle = sweep;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
        ctx.restore();
      }

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
