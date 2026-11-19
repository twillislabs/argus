// The satellite layer: every catalogued object as a point, moved once a
// second from SGP4 positions computed in satWorker, plus the selected
// satellite's orbit ring, ground track and label.

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import {
  HorizontalOrigin,
  type Label,
  LabelCollection,
  LabelStyle,
  Material,
  type PointPrimitive,
  PointPrimitiveCollection,
  type Polyline,
  PolylineCollection,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

export type OrbitClass = 'leo' | 'meo' | 'geo' | 'heo';

export interface SpaceFilters {
  leo: boolean;
  meo: boolean;
  geo: boolean;
  heo: boolean;
  starlink: boolean;
}

export const DEFAULT_SPACE: SpaceFilters = {
  leo: false,
  meo: false,
  geo: false,
  heo: false,
  starlink: false,
};

export const SAT_COLOR: Record<OrbitClass | 'station', string> = {
  leo: '#b49cff',
  meo: '#7fd1c7',
  geo: '#f0c94a',
  heo: '#ff9447',
  station: '#ffffff',
};

export interface SatMeta {
  norad: number;
  name: string;
  cospar: string;
  cls: OrbitClass;
  tags: string[];
}

export interface SatCatalog {
  updated: string | null;
  meta: SatMeta[];
  raw: (string | number | string[])[][];
}

export interface OrbitInfo {
  altKm: number;
  speedKms: number;
  periodMin: number;
}

export interface Pass {
  rise: number;
  set: number;
  peak: number;
  maxEl: number;
}

export function satVisible(m: SatMeta, f: SpaceFilters): boolean {
  if (m.tags.includes('station')) return f.leo || f.meo || f.geo || f.heo || f.starlink;
  if (m.tags.includes('starlink')) return f.starlink;
  return f[m.cls];
}

export interface SatelliteLayer {
  load: (catalog: SatCatalog) => void;
  setFilter: (f: SpaceFilters) => void;
  select: (norad: number | null) => void;
  // Latest Earth-fixed position of a satellite (metres), if known.
  position: (norad: number) => Cartesian3 | null;
  orbit: (norad: number) => Promise<OrbitInfo | null>;
  passes: (norad: number, lat: number, lon: number, hours?: number) => Promise<Pass[]>;
  onTick: (fn: (() => void) | null) => void;
  counts: () => Record<OrbitClass | 'starlink', number>;
  destroy: () => void;
}

export function addSatelliteLayer(scene: Scene): SatelliteLayer {
  const points = new PointPrimitiveCollection();
  const lines = new PolylineCollection();
  const labels = new LabelCollection({ scene });
  scene.primitives.add(lines);
  scene.primitives.add(points);
  scene.primitives.add(labels);

  const worker = new Worker(new URL('./satWorker.ts', import.meta.url), { type: 'module' });
  let meta: SatMeta[] = [];
  let byNorad = new Map<number, { meta: SatMeta; point: PointPrimitive; index: number }>();
  let order: number[] = [];
  let filter = DEFAULT_SPACE;
  let selected: number | null = null;
  let label: Label | null = null;
  let ring: Polyline | null = null;
  let track: Polyline | null = null;
  let positions: Float64Array | null = null;
  let tickListener: (() => void) | null = null;
  let nextId = 1;
  const pending = new Map<number, (data: unknown) => void>();
  let timer: number | undefined;
  let destroyed = false;
  const scale = new NearFarScalar(1.0e6, 1.6, 5.0e7, 0.7);
  const scratch = new Cartesian3();

  function request<T>(msg: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve as (d: unknown) => void);
      worker.postMessage({ ...msg, id });
    });
  }

  function styleFor(m: SatMeta, isSelected: boolean) {
    const css = m.tags.includes('station') ? SAT_COLOR.station : SAT_COLOR[m.cls];
    return {
      color: Color.fromCssColorString(css).withAlpha(isSelected ? 1 : 0.85),
      pixelSize: isSelected ? 9 : m.tags.includes('station') ? 6 : 3.5,
      outlineColor: isSelected ? Color.WHITE : Color.fromCssColorString('#05080e'),
      outlineWidth: isSelected ? 2 : 0.5,
    };
  }

  function applyVisibility() {
    for (const { meta: m, point } of byNorad.values()) {
      point.show = m.norad === selected || satVisible(m, filter);
    }
  }

  function tick() {
    if (destroyed || !meta.length) return;
    // Propagate only while some satellites are on.
    const any = filter.leo || filter.meo || filter.geo || filter.heo || filter.starlink || selected !== null;
    if (any) worker.postMessage({ type: 'tick', id: 0, time: Date.now() });
  }

  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as { type: string; id?: number; norads?: Int32Array; positions?: Float64Array };
    if (data.type === 'loaded' && data.norads) {
      order = Array.from(data.norads);
      tick();
      return;
    }
    if (data.type === 'tick' && data.positions) {
      positions = data.positions;
      for (let i = 0; i < order.length; i++) {
        const item = byNorad.get(order[i]);
        if (!item) continue;
        item.index = i;
        const x = positions[i * 3];
        if (Number.isNaN(x)) {
          item.point.show = false;
          continue;
        }
        if (!item.point.show) continue;
        scratch.x = x;
        scratch.y = positions[i * 3 + 1];
        scratch.z = positions[i * 3 + 2];
        item.point.position = scratch;
      }
      if (label && selected !== null) {
        const p = byNorad.get(selected);
        if (p) label.position = p.point.position;
      }
      tickListener?.();
      return;
    }
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)?.(data);
      pending.delete(data.id);
    }
  };

  async function drawOrbit(norad: number) {
    const result = await request<{ ring?: number[]; track?: number[]; error?: string }>({
      type: 'orbit',
      norad,
      time: Date.now(),
    });
    if (selected !== norad || destroyed || !result.ring || !result.track) return;
    for (const l of [ring, track]) if (l) lines.remove(l);
    const ringPositions: Cartesian3[] = [];
    for (let i = 0; i < result.ring.length; i += 3) {
      ringPositions.push(new Cartesian3(result.ring[i], result.ring[i + 1], result.ring[i + 2]));
    }
    const color = Color.fromCssColorString(SAT_COLOR[byNorad.get(norad)?.meta.cls ?? 'leo']);
    ring = lines.add({
      positions: ringPositions,
      width: 1.5,
      material: Material.fromType('Color', { color: color.withAlpha(0.75) }),
    });
    const lifted: number[] = [];
    const flat = unwrap(result.track);
    // A little above the ground so land shapes don't hide it.
    for (let i = 0; i < flat.length; i += 2) lifted.push(flat[i], flat[i + 1], 3000);
    track = lines.add({
      positions: Cartesian3.fromDegreesArrayHeights(lifted),
      width: 1.2,
      material: Material.fromType('PolylineDash', { color: color.withAlpha(0.55), dashLength: 12 }),
    });
  }

  const orbitTimer = window.setInterval(() => {
    if (selected !== null) void drawOrbit(selected);
  }, 60_000);

  return {
    load(catalog) {
      meta = catalog.meta;
      points.removeAll();
      byNorad = new Map();
      for (const m of meta) {
        const point = points.add({
          id: 'sat:' + m.norad,
          position: Cartesian3.ZERO,
          ...styleFor(m, false),
          scaleByDistance: scale,
          show: false,
        });
        byNorad.set(m.norad, { meta: m, point, index: -1 });
      }
      applyVisibility();
      worker.postMessage({ type: 'load', satellites: catalog.raw });
      window.clearInterval(timer);
      timer = window.setInterval(tick, 1000);
    },
    setFilter(f) {
      filter = f;
      applyVisibility();
      tick();
    },
    select(norad) {
      if (norad === selected) return;
      const prev = selected !== null ? byNorad.get(selected) : undefined;
      if (prev) Object.assign(prev.point, styleFor(prev.meta, false));
      for (const l of [ring, track]) if (l) lines.remove(l);
      ring = track = null;
      if (label) labels.remove(label);
      label = null;
      selected = norad;
      const item = norad !== null ? byNorad.get(norad) : undefined;
      if (item) {
        Object.assign(item.point, styleFor(item.meta, true));
        label = labels.add({
          position: item.point.position,
          text: item.meta.name,
          font: '600 12px "JetBrains Mono", monospace',
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString('#05080e'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          distanceDisplayCondition: new DistanceDisplayCondition(0, Number.MAX_VALUE),
        });
        void drawOrbit(item.meta.norad);
      }
      applyVisibility();
      tick();
    },
    position(norad) {
      const item = byNorad.get(norad);
      if (!item || !positions || item.index < 0) return null;
      const x = positions[item.index * 3];
      if (Number.isNaN(x)) return null;
      return new Cartesian3(x, positions[item.index * 3 + 1], positions[item.index * 3 + 2]);
    },
    async orbit(norad) {
      const r = await request<OrbitInfo & { error?: string }>({ type: 'orbit', norad, time: Date.now() });
      return r.error ? null : { altKm: r.altKm, speedKms: r.speedKms, periodMin: r.periodMin };
    },
    async passes(norad, lat, lon, hours = 24) {
      const r = await request<{ passes?: Pass[] }>({ type: 'passes', norad, time: Date.now(), lat, lon, hours });
      return r.passes ?? [];
    },
    onTick(fn) {
      tickListener = fn;
    },
    counts() {
      const c = { leo: 0, meo: 0, geo: 0, heo: 0, starlink: 0 };
      for (const m of meta) {
        if (m.tags.includes('starlink')) c.starlink++;
        else c[m.cls]++;
      }
      return c;
    },
    destroy() {
      destroyed = true;
      window.clearInterval(timer);
      window.clearInterval(orbitTimer);
      worker.terminate();
      if (scene.isDestroyed()) return;
      for (const p of [lines, points, labels]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}

// Ground track longitudes jump at the antimeridian; Cesium draws the line
// the short way round, so continuing past +-180 keeps it on course.
function unwrap(lonLat: number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  let prev: number | null = null;
  for (let i = 0; i < lonLat.length; i += 2) {
    let lon = lonLat[i];
    if (prev !== null) {
      if (lon + offset - prev > 180) offset -= 360;
      else if (lon + offset - prev < -180) offset += 360;
    }
    lon += offset;
    prev = lon;
    out.push(lon, lonLat[i + 1]);
  }
  return out;
}
