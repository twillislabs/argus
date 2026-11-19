// Airspace areas: FAA TFRs, SIGMETs (coloured by hazard) and EASA
// conflict zone bulletins (the affected countries tinted). Translucent
// fills with outlines; each is pickable as "air:<key>".

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
} from '@cesium/core';
import {
  Material,
  PerInstanceColorAppearance,
  PolylineCollection,
  Primitive,
  type Scene,
} from '@cesium/engine';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

import type { AirspaceItem } from '../lib/api';
import { hatchLines, type LonLat } from '../lib/geo';
import { lineBatch } from './lineBatch';

export interface AirspaceFilters {
  tfr: boolean;
  sigmet: boolean;
  czib: boolean;
  gps: boolean;
  structure: boolean;
}

export const DEFAULT_AIRSPACE: AirspaceFilters = {
  tfr: false,
  sigmet: false,
  czib: false,
  gps: false,
  structure: false,
};

export const AIRSPACE_COLOR = {
  tfr: '#ff5260',
  czib: '#ff5d8f',
  sigmet: '#f0c94a',
  gps: '#ff6ba1',
  structure: '#5b9bff',
};

export const STRUCTURE_COLOR: Record<string, string> = {
  Restricted: '#ff5260',
  Prohibited: '#ff2d3d',
  Danger: '#ff9447',
  'Control zone (CTR)': '#5b9bff',
  'Terminal area (TMA)': '#8cc8ff',
  'Control area (CTA)': '#8cc8ff',
  'Military training area (MTA)': '#ff5d8f',
  'Temporary reserved (TRA)': '#ff5d8f',
  'Temporary segregated (TSA)': '#ff5d8f',
  'Warning area': '#ff9447',
  'Alert area': '#e3c04b',
};

const HAZARD_COLOR: Record<string, string> = {
  Thunderstorms: '#f0c94a',
  Turbulence: '#ff9447',
  Icing: '#8cc8ff',
  'Volcanic ash': '#b49cff',
  'Tropical cyclone': '#ff5260',
  'Mountain waves': '#7fd1c7',
  'Low visibility': '#9aa7ba',
};

export function airspaceColor(item: AirspaceItem): string {
  if (item.kind === 'sigmet') return HAZARD_COLOR[item.hazard ?? ''] ?? AIRSPACE_COLOR.sigmet;
  if (item.kind === 'structure') return STRUCTURE_COLOR[item.hazard ?? ''] ?? '#9aa7ba';
  return AIRSPACE_COLOR[item.kind];
}

let countryShapes: Promise<Map<string, number[][][]>> | null = null;

// Country outer rings by name (Natural Earth 110m), for CZIBs.
function countries(): Promise<Map<string, number[][][]>> {
  countryShapes ??= fetch('/data/countries-110m.json')
    .then((r) => r.json())
    .then((topo: Topology) => {
      const fc = feature(topo, topo.objects.countries as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
      const out = new Map<string, number[][][]>();
      for (const f of fc.features) {
        const name = String((f.properties as { name?: string })?.name ?? '').toLowerCase();
        const g = f.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        out.set(
          name,
          polys.map((rings) => rings[0] as number[][]),
        );
      }
      return out;
    })
    .catch(() => new Map());
  return countryShapes;
}

export interface AirspaceLayer {
  update: (items: AirspaceItem[], filters: AirspaceFilters, selectedKey: string | null) => Promise<void>;
  destroy: () => void;
}

export function addAirspaceLayer(scene: Scene): AirspaceLayer {
  let fill: Primitive | null = null;
  // Closed airspace (conflict zone bulletins): diagonal hatch lines, one
  // batched primitive per colour.
  let hatches: Primitive[] = [];
  const outlines = new PolylineCollection();
  scene.primitives.add(outlines);
  let generation = 0;

  return {
    async update(items, filters, selectedKey) {
      const mine = ++generation;
      const shapes = await countries();
      if (mine !== generation || scene.isDestroyed()) return;
      if (fill && scene.primitives.contains(fill)) scene.primitives.remove(fill);
      fill = null;
      for (const h of hatches) if (scene.primitives.contains(h)) scene.primitives.remove(h);
      hatches = [];
      outlines.removeAll();
      const instances: GeometryInstance[] = [];
      const hatchSegments: { lines: LonLat[][]; css: string; selected: boolean }[] = [];
      for (const item of items) {
        if (!filters[item.kind]) continue;
        const rings: number[][][] = [];
        if (item.polygon && item.polygon.length >= 4) rings.push(item.polygon);
        if (item.kind === 'czib') {
          for (const c of item.countries ?? []) rings.push(...(shapes.get(c.toLowerCase()) ?? []));
        }
        const selected = item.key === selectedKey;
        const color = Color.fromCssColorString(airspaceColor(item));
        for (const ring of rings) {
          const positions = Cartesian3.fromDegreesArray(ring.slice(0, -1).flatMap(([lon, lat]) => [lon, lat]));
          if (positions.length < 3) continue;
          instances.push(
            new GeometryInstance({
              id: 'air:' + item.key,
              geometry: new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(positions),
                height: 900,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              attributes: {
                color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(selected ? 0.34 : 0.16)),
              },
            }),
          );
          const closed = item.kind === 'czib';
          outlines.add({
            positions: Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lon, lat]) => [lon, lat, 1200])),
            width: selected ? 2.5 : closed ? 1.5 : 1.3,
            // Closed airspace: a dashed edge, as in the mock-up.
            material: closed
              ? Material.fromType('PolylineDash', { color: color.withAlpha(selected ? 1 : 0.8), dashLength: 10 })
              : Material.fromType('Color', { color: color.withAlpha(selected ? 1 : 0.75) }),
          });
          if (closed) {
            // Diagonal hatching, as in the mock-up: about 0.4° apart.
            const lines = hatchLines(ring as LonLat[], 0.4);
            if (lines.length) hatchSegments.push({ lines, css: airspaceColor(item), selected });
          }
        }
      }
      // One batch per colour, so the whole hatch is a few draw calls.
      const byColour = new Map<string, LonLat[][]>();
      for (const h of hatchSegments) {
        const css = Color.fromCssColorString(h.css)
          .withAlpha(h.selected ? 0.7 : 0.45)
          .toCssColorString();
        const list = byColour.get(css) ?? [];
        for (const l of h.lines) list.push(l);
        byColour.set(css, list);
      }
      for (const [css, lines] of byColour) {
        const batch = lineBatch(scene, lines, css, 1, 1000);
        hatches.push(batch.primitive);
        scene.primitives.add(batch.primitive);
      }
      if (!instances.length) return;
      fill = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      });
      scene.primitives.add(fill);
    },
    destroy() {
      generation++;
      if (scene.isDestroyed()) return;
      for (const p of [fill, outlines, ...hatches]) {
        if (p && !p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
