// Country tension tint: countries from "elevated" (35) up are washed in
// red, deeper the higher the index (80 and up is severe). Shapes are Natural Earth 50m, the
// same file the borders come from.

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
} from '@cesium/core';
import { PerInstanceColorAppearance, Primitive, type Scene } from '@cesium/engine';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

import type { TensionCountry } from '../lib/api';

export const TENSION_COLOR = '#b8505a';
const FILL = '#ff5260';
// Tinted from "elevated" up.
export const TINT_FROM = 35;
const HEIGHT = 600;

// Argus country names (GDELT / GeoNames) to Natural Earth's short names.
const NE_NAME: Record<string, string> = {
  'United States': 'United States of America',
  'Democratic Republic of the Congo': 'Dem. Rep. Congo',
  'Republic of the Congo': 'Congo',
  'Central African Republic': 'Central African Rep.',
  'South Sudan': 'S. Sudan',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'Dominican Republic': 'Dominican Rep.',
  'Western Sahara': 'W. Sahara',
  'Equatorial Guinea': 'Eq. Guinea',
  'North Macedonia': 'Macedonia',
  'Solomon Islands': 'Solomon Is.',
  'East Timor': 'Timor-Leste',
  'Czech Republic': 'Czechia',
};

export const naturalEarthName = (name: string) => NE_NAME[name] ?? name;

type Rings = number[][][];
let shapes: Promise<Map<string, Rings[]>> | null = null;

function loadShapes(): Promise<Map<string, Rings[]>> {
  shapes ??= fetch('/data/countries-50m.json')
    .then((r) => (r.ok ? (r.json() as Promise<Topology>) : null))
    .then((topo) => {
      const out = new Map<string, Rings[]>();
      if (!topo) return out;
      const fc = feature(topo, topo.objects.countries as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
      for (const f of fc.features) {
        const name = (f.properties as { name?: string } | null)?.name;
        const g = f.geometry;
        if (!name || !g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        out.set(name, polys as Rings[]);
      }
      return out;
    })
    .catch(() => new Map());
  return shapes;
}

function hierarchy(rings: Rings): PolygonHierarchy {
  const pos = (ring: number[][]) => Cartesian3.fromDegreesArray(ring.slice(0, -1).flatMap(([x, y]) => [x, y]));
  return new PolygonHierarchy(
    pos(rings[0]),
    rings.slice(1).map((h) => new PolygonHierarchy(pos(h))),
  );
}

export interface TensionLayer {
  update: (countries: TensionCountry[], visible: boolean) => void;
  // A world-view layer, like the mock-up: hidden once you zoom in.
  setHeight: (metres: number) => void;
  destroy: () => void;
}

const HIDE_BELOW = 2.2e6;

export function addTensionLayer(scene: Scene): TensionLayer {
  let prim: Primitive | null = null;
  let version = 0;
  let high = true;
  const clear = () => {
    if (prim && !scene.isDestroyed() && scene.primitives.contains(prim)) scene.primitives.remove(prim);
    prim = null;
  };
  return {
    update(countries, visible) {
      const mine = ++version;
      clear();
      const hot = visible ? countries.filter((c) => c.level >= TINT_FROM) : [];
      if (!hot.length) return;
      void loadShapes().then((byName) => {
        if (mine !== version || scene.isDestroyed()) return;
        const base = Color.fromCssColorString(FILL);
        const instances: GeometryInstance[] = [];
        for (const c of hot) {
          const polys = byName.get(naturalEarthName(c.name));
          if (!polys) continue;
          // Elevated (55) faint, severe (90+) strongest.
          // As in the mock-up: up to about a third opaque at the top.
          const alpha = 0.06 + Math.min(1, (c.level - TINT_FROM) / 60) * 0.28;
          for (const rings of polys) {
            instances.push(
              new GeometryInstance({
                id: 'tension:' + c.name,
                geometry: new PolygonGeometry({
                  polygonHierarchy: hierarchy(rings),
                  height: HEIGHT,
                  vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: { color: ColorGeometryInstanceAttribute.fromColor(base.withAlpha(alpha)) },
              }),
            );
          }
        }
        if (!instances.length) return;
        prim = new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: true,
        });
        prim.show = high;
        scene.primitives.add(prim);
      });
    },
    setHeight(metres) {
      high = metres >= HIDE_BELOW;
      if (prim) prim.show = high;
    },
    destroy: () => {
      version++;
      clear();
    },
  };
}
