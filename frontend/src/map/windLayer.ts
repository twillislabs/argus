// Animated wind at 10 m (NOAA GFS, /api/weather/wind): particles drift
// with the wind and leave fading trails, coloured by speed.
//
// They're drawn on a 2D canvas laid over the globe, not by Cesium: the
// globe keeps redrawing only when something changes (map/render.ts), and
// this canvas animates on its own at a modest rate (FPS by render mode).
// While the view moves the trails are cleared every frame, and the
// particles are scattered over the new view when it stops. Particles on
// the far side of the globe are skipped.

import { Cartesian3, Math as CesiumMath, Rectangle } from '@cesium/core';
import { SceneMode, type CesiumWidget } from '@cesium/engine';

import type { RenderMode, WindGrid } from '../lib/api';

// Speed bands (m/s) and their colours, calm to gale.
export const WIND_BANDS: { upTo: number; color: string; label: string }[] = [
  { upTo: 3, color: '#6fb7ff', label: 'under 3 m/s' },
  { upTo: 6, color: '#7ee0c2', label: '3–6 m/s' },
  { upTo: 10, color: '#d7f06a', label: '6–10 m/s' },
  { upTo: 15, color: '#ffc04a', label: '10–15 m/s' },
  { upTo: 20, color: '#ff7b4a', label: '15–20 m/s' },
  { upTo: Infinity, color: '#ff4fa3', label: '20 m/s and over' },
];
const FPS: Record<RenderMode, number> = { smooth: 30, balanced: 24, saver: 12 };
// Particles per 10,000 screen pixels (capped), fewer in saver mode.
const DENSITY: Record<RenderMode, number> = { smooth: 9, balanced: 7, saver: 4 };
const MAX_PARTICLES = 4000;
const MAX_AGE = 90;
// How far a particle moves a frame, as a share of the view's width per
// m/s: fast enough to read the flow at any zoom.
const SPEED = 0.00022;
const FADE = 0.93;

interface Particle {
  lon: number;
  lat: number;
  age: number;
}

export interface WindLayer {
  update: (grid: WindGrid | null, visible: boolean) => void;
  setMode: (mode: RenderMode) => void;
  destroy: () => void;
}

// The wind (u, v) at a spot, bilinear between the grid's points.
function sample(g: WindGrid, lon: number, lat: number): [number, number] {
  const x = ((((lon - g.lon0) % 360) + 360) % 360) / g.dlon;
  const y = (g.lat0 - lat) / g.dlat;
  const x0 = Math.floor(x);
  const y0 = Math.max(0, Math.min(g.ny - 2, Math.floor(y)));
  const fx = x - x0;
  const fy = Math.max(0, Math.min(1, y - y0));
  const c0 = x0 % g.nx;
  const c1 = (x0 + 1) % g.nx;
  const i00 = y0 * g.nx + c0;
  const i10 = y0 * g.nx + c1;
  const i01 = (y0 + 1) * g.nx + c0;
  const i11 = (y0 + 1) * g.nx + c1;
  const mix = (a: number[]) => (a[i00] * (1 - fx) + a[i10] * fx) * (1 - fy) + (a[i01] * (1 - fx) + a[i11] * fx) * fy;
  return [mix(g.u), mix(g.v)];
}

function band(speed: number): number {
  for (let i = 0; i < WIND_BANDS.length; i++) if (speed < WIND_BANDS[i].upTo) return i;
  return WIND_BANDS.length - 1;
}

export function addWindLayer(v: CesiumWidget, initialMode: RenderMode): WindLayer {
  const scene = v.scene;
  const canvas = document.createElement('canvas');
  canvas.className = 'wind-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  v.container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let grid: WindGrid | null = null;
  let visible = false;
  let mode = initialMode;
  let particles: Particle[] = [];
  // Scratch for the view (Rectangle.MAX_VALUE is frozen: never pass it).
  const view = new Rectangle();
  let moving = false;
  let raf = 0;
  let last = 0;
  const scratch = new Cartesian3();
  const toCamera = new Cartesian3();

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  // The view in degrees [west, south, east, north] (east past 180 when
  // it crosses the date line).
  const viewDegrees = (): [number, number, number, number] => {
    const r = scene.camera.computeViewRectangle(scene.globe.ellipsoid, view) ?? Rectangle.MAX_VALUE;
    const w = CesiumMath.toDegrees(r.west);
    let e = CesiumMath.toDegrees(r.east);
    if (e < w) e += 360;
    return [w, CesiumMath.toDegrees(r.south), e, CesiumMath.toDegrees(r.north)];
  };
  let box = viewDegrees();

  const spawn = (p: Particle) => {
    const [w, s, e, n] = box;
    p.lon = w + Math.random() * (e - w);
    // Even over the area, not crowded at the poles.
    const ys = Math.sin(s * CesiumMath.RADIANS_PER_DEGREE);
    const yn = Math.sin(n * CesiumMath.RADIANS_PER_DEGREE);
    p.lat = Math.asin(ys + Math.random() * (yn - ys)) * CesiumMath.DEGREES_PER_RADIAN;
    p.age = Math.floor(Math.random() * MAX_AGE);
  };

  const scatter = () => {
    resize();
    box = viewDegrees();
    const want = Math.min(MAX_PARTICLES, Math.round((canvas.width * canvas.height * DENSITY[mode]) / 10_000));
    particles = Array.from({ length: want }, () => {
      const p = { lon: 0, lat: 0, age: 0 };
      spawn(p);
      return p;
    });
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Where a spot is on the canvas, or null behind the globe / off it.
  const project = (lon: number, lat: number) => {
    Cartesian3.fromDegrees(lon, lat, 0, undefined, scratch);
    if (scene.mode === SceneMode.SCENE3D) {
      Cartesian3.subtract(scene.camera.positionWC, scratch, toCamera);
      if (Cartesian3.dot(scratch, toCamera) <= 0) return null;
    }
    return scene.cartesianToCanvasCoordinates(scratch);
  };

  const paths = WIND_BANDS.map(() => new Path2D());
  const frame = (t: number) => {
    raf = window.requestAnimationFrame(frame);
    if (!visible || !grid || !ctx || document.hidden || scene.isDestroyed()) return;
    if (t - last < 1000 / FPS[mode]) return;
    last = t;
    resize();
    const [w, , e] = box;
    const step = (e - w) * SPEED;
    // Fade the trails (all of them while the view moves).
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0, 0, 0, ' + (moving ? 0 : FADE) + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < paths.length; i++) paths[i] = new Path2D();
    for (const p of particles) {
      if (++p.age > MAX_AGE) {
        spawn(p);
        p.age = 0;
        continue;
      }
      const [u, vv] = sample(grid, p.lon, p.lat);
      const speed = Math.hypot(u, vv);
      const from = project(p.lon, p.lat);
      const cos = Math.max(0.05, Math.cos(p.lat * CesiumMath.RADIANS_PER_DEGREE));
      p.lon += (u * step) / cos;
      p.lat += vv * step;
      if (p.lat > 85 || p.lat < -85 || speed < 0.05) {
        spawn(p);
        continue;
      }
      const to = project(p.lon, p.lat);
      if (!from || !to) continue;
      // A jump across the screen (date line, globe edge) isn't a trail.
      if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) > 60) continue;
      const path = paths[band(speed)];
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < paths.length; i++) {
      ctx.strokeStyle = WIND_BANDS[i].color;
      ctx.stroke(paths[i]);
    }
    ctx.globalAlpha = 1;
  };
  raf = window.requestAnimationFrame(frame);

  const stopStart = scene.camera.moveStart.addEventListener(() => {
    moving = true;
  });
  const stopEnd = scene.camera.moveEnd.addEventListener(() => {
    moving = false;
    if (visible) scatter();
  });
  const onResize = () => visible && scatter();
  window.addEventListener('resize', onResize);

  return {
    update(g, on) {
      const was = visible && grid;
      grid = g && g.status === 'ok' && g.u.length === g.nx * g.ny ? g : null;
      visible = on;
      canvas.style.display = on && grid ? '' : 'none';
      if (on && grid && !was) scatter();
      if (!on) particles = [];
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (visible && grid) scatter();
    },
    destroy() {
      window.cancelAnimationFrame(raf);
      stopStart();
      stopEnd();
      window.removeEventListener('resize', onResize);
      canvas.remove();
    },
  };
}
