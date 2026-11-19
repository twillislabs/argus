// Infrastructure: power plants (WRI Global Power Plant Database, bundled)
// and submarine cables with landing points (TeleGeography, fetched onto
// this server by the worker).

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import {
  BillboardCollection,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  PointPrimitiveCollection,
  PolylineCollection,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

export interface InfraFilters {
  nuclear: boolean;
  power: boolean;
  cables: boolean;
  bases: boolean;
  // ALPR cameras (map/alprLayer.ts), fetched for the view.
  alpr: boolean;
  // Cyber (map/cyberLayer.ts): internet outages and ransomware victims.
  outages: boolean;
  ransomware: boolean;
}

export const DEFAULT_INFRA: InfraFilters = {
  nuclear: false,
  power: false,
  cables: false,
  bases: false,
  alpr: false,
  outages: false,
  ransomware: false,
};

export const BASE_COLOR = '#ff5d8f';
export const BASE_KINDS: Record<string, string> = {
  base: 'Military base',
  airfield: 'Military airfield',
  naval_base: 'Naval base',
  range: 'Firing range',
  training_area: 'Training area',
  barracks: 'Barracks',
};

export type Base = [string, string, number, number, string];

export const FUEL_COLOR: Record<string, string> = {
  Nuclear: '#d0aa6c', // the mock-up's infrastructure tan
  Coal: '#a08070',
  Gas: '#ff9447',
  Oil: '#b8505a',
  Hydro: '#3fa7ff',
  Wind: '#7fd1c7',
  Solar: '#f0c94a',
  Other: '#9aa7ba',
};

export type Plant = [string, string, string, number, number, number];

export interface InfraLayer {
  setFilters: (f: InfraFilters) => void;
  plants: () => Plant[];
  cable: (id: string) => { name: string; id: string } | null;
  bases: () => Base[];
  destroy: () => void;
}

// Nuclear plants as in the mock-up: a dark diamond with a tan edge.
function diamondImage(css: string): HTMLCanvasElement {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const m = px / 2;
  const r = m - 3;
  ctx.beginPath();
  ctx.moveTo(m, m - r);
  ctx.lineTo(m + r, m);
  ctx.lineTo(m, m + r);
  ctx.lineTo(m - r, m);
  ctx.closePath();
  ctx.fillStyle = '#0b0e13';
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = css;
  ctx.stroke();
  return c;
}

export function addInfraLayer(scene: Scene): InfraLayer {
  const nuclear = new BillboardCollection({ scene });
  const power = new PointPrimitiveCollection();
  const nuclearLabels = new LabelCollection({ scene });
  const cables = new PolylineCollection();
  const landings = new PointPrimitiveCollection();
  const baseDots = new PointPrimitiveCollection();
  const baseLabels = new LabelCollection({ scene });
  const all = [cables, landings, power, nuclear, nuclearLabels, baseDots, baseLabels];
  for (const p of all) scene.primitives.add(p);
  for (const p of all) p.show = false;
  let baseRows: Base[] = [];
  let basesLoaded = false;
  let plantRows: Plant[] = [];
  const cableNames = new Map<string, string>();
  let cablesLoaded = false;
  let filters = DEFAULT_INFRA;
  const dark = Color.fromCssColorString('#05080e');

  const diamond = diamondImage(FUEL_COLOR.Nuclear);

  void fetch('/data/power.json')
    .then((r) => r.json())
    .then((rows: Plant[]) => {
      plantRows = rows;
      rows.forEach(([name, , fuel, mw, lon, lat], i) => {
        const position = Cartesian3.fromDegrees(lon, lat, 1000);
        const color = Color.fromCssColorString(FUEL_COLOR[fuel] ?? FUEL_COLOR.Other);
        const size = Math.max(4, Math.min(11, 3 + Math.sqrt(mw) / 9));
        if (fuel === 'Nuclear') {
          // 32 px image: about 13-20 px on screen, by capacity.
          nuclear.add({
            id: 'pp:' + i,
            position,
            image: diamond,
            scale: Math.max(0.4, Math.min(0.62, 0.3 + Math.sqrt(mw) / 150)),
            scaleByDistance: new NearFarScalar(2e5, 1.2, 1.2e7, 0.7),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 2.0e7),
          });
        } else {
          power.add({
            id: 'pp:' + i,
            position,
            pixelSize: size,
            color: color.withAlpha(0.9),
            outlineColor: dark,
            outlineWidth: 1,
            scaleByDistance: new NearFarScalar(2e5, 1.2, 1.2e7, 0.6),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 4.0e6),
          });
        }
        if (fuel === 'Nuclear') {
          nuclearLabels.add({
            position,
            text: name,
            font: '500 10.5px Inter, system-ui, sans-serif',
            fillColor: color,
            outlineColor: dark,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(8, 0),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 6.0e5),
          });
        }
      });
    })
    .catch(() => undefined);

  async function loadCables() {
    if (cablesLoaded) return;
    cablesLoaded = true;
    try {
      const r = await fetch('/api/layers/cables', { credentials: 'same-origin' });
      if (!r.ok) return;
      const body = (await r.json()) as {
        cables: GeoJSON.FeatureCollection;
        landings: GeoJSON.FeatureCollection;
      };
      for (const f of body.cables.features) {
        const p = (f.properties ?? {}) as { id?: string; name?: string; color?: string };
        const g = f.geometry;
        const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
        cableNames.set(p.id ?? '', p.name ?? p.id ?? 'Cable');
        const color = Color.fromCssColorString(p.color ?? '#7fd1c7').withAlpha(0.85);
        for (const line of lines) {
          if (line.length < 2) continue;
          cables.add({
            id: 'cable:' + (p.id ?? ''),
            positions: Cartesian3.fromDegreesArrayHeights(line.flatMap(([lon, lat]) => [lon, lat, 500])),
            width: 1.4,
            material: Material.fromType('Color', { color }),
          });
        }
      }
      for (const f of body.landings.features) {
        if (f.geometry.type !== 'Point') continue;
        const [lon, lat] = f.geometry.coordinates;
        landings.add({
          position: Cartesian3.fromDegrees(lon, lat, 600),
          pixelSize: 3.5,
          color: Color.fromCssColorString('#d4dae2'),
          outlineColor: dark,
          outlineWidth: 1,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 5.0e6),
        });
      }
    } catch {
      cablesLoaded = false;
    }
  }

  async function loadBases() {
    if (basesLoaded) return;
    basesLoaded = true;
    try {
      const r = await fetch('/data/bases.json');
      if (!r.ok) return;
      baseRows = (await r.json()) as Base[];
      const color = Color.fromCssColorString(BASE_COLOR);
      baseRows.forEach(([name, kind, lon, lat], i) => {
        const position = Cartesian3.fromDegrees(lon, lat, 1000);
        const major = kind === 'base' || kind === 'naval_base' || kind === 'airfield';
        baseDots.add({
          id: 'mil:' + i,
          position,
          pixelSize: major ? 6 : 4,
          color: dark,
          outlineColor: major ? color : color.withAlpha(0.6),
          outlineWidth: 1.6,
          distanceDisplayCondition: new DistanceDisplayCondition(0, major ? 3.0e6 : 8.0e5),
        });
        if (major) {
          baseLabels.add({
            position,
            text: name,
            font: '500 10.5px Inter, system-ui, sans-serif',
            fillColor: color,
            outlineColor: dark,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(8, 0),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 2.5e5),
          });
        }
      });
    } catch {
      basesLoaded = false;
    }
  }

  return {
    setFilters(f) {
      filters = f;
      nuclear.show = filters.nuclear || filters.power;
      nuclearLabels.show = nuclear.show;
      power.show = filters.power;
      cables.show = landings.show = filters.cables;
      if (filters.cables) void loadCables();
      baseDots.show = baseLabels.show = filters.bases;
      if (filters.bases) void loadBases();
    },
    plants: () => plantRows,
    bases: () => baseRows,
    cable(id) {
      const name = cableNames.get(id);
      return name ? { id, name } : null;
    },
    destroy() {
      if (scene.isDestroyed()) return;
      for (const p of all) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
