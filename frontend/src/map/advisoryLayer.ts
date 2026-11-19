// Travel advisories: countries the US State Department or the UK FCDO
// warn about, outlined and lightly washed in the worse of the two levels
// (2 increased caution, 3 reconsider / parts, 4 do not travel). Level 1
// is left clear. Pickable as "adv:<Natural Earth name>".

import { Color, ColorGeometryInstanceAttribute, GeometryInstance, PolygonGeometry } from '@cesium/core';
import { PerInstanceColorAppearance, Primitive, type Scene } from '@cesium/engine';

import type { Advisory } from '../lib/api';
import { lineBatch } from './lineBatch';
import { hierarchy, loadShapes } from './tensionLayer';

export const ADVISORY_COLOR: Record<number, string> = { 2: '#e3c04b', 3: '#ff9447', 4: '#ff5260' };
const FILL_ALPHA: Record<number, number> = { 2: 0.06, 3: 0.12, 4: 0.18 };
const HEIGHT = 700;

export interface AdvisoryLayer {
  update: (rows: Advisory[], visible: boolean) => void;
  destroy: () => void;
}

export function addAdvisoryLayer(scene: Scene): AdvisoryLayer {
  let prims: Primitive[] = [];
  let version = 0;
  const clear = () => {
    for (const p of prims) if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    prims = [];
  };
  return {
    update(rows, visible) {
      const mine = ++version;
      clear();
      const shown = visible ? rows.filter((r) => r.level >= 2) : [];
      if (!shown.length) return;
      void loadShapes().then((byName) => {
        if (mine !== version || scene.isDestroyed()) return;
        const instances: GeometryInstance[] = [];
        const edges = new Map<number, number[][][]>();
        for (const r of shown) {
          const polys = byName.get(r.country);
          if (!polys) continue;
          const color = Color.fromCssColorString(ADVISORY_COLOR[r.level]);
          for (const rings of polys) {
            instances.push(
              new GeometryInstance({
                id: 'adv:' + r.country,
                geometry: new PolygonGeometry({
                  polygonHierarchy: hierarchy(rings),
                  height: HEIGHT,
                  vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: { color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(FILL_ALPHA[r.level])) },
              }),
            );
            // Level 2 covers most of the world: a wash only, no edge.
            if (r.level >= 3) {
              const list = edges.get(r.level) ?? [];
              list.push(rings[0]);
              edges.set(r.level, list);
            }
          }
        }
        if (!instances.length) return;
        const fill = new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: true,
        });
        prims = [fill];
        for (const [level, lines] of edges) {
          prims.push(
            lineBatch(
              scene,
              lines,
              Color.fromCssColorString(ADVISORY_COLOR[level]).withAlpha(0.7).toCssColorString(),
              1.4,
              HEIGHT + 200,
            ).primitive,
          );
        }
        for (const p of prims) scene.primitives.add(p);
      });
    },
    destroy: () => {
      version++;
      clear();
    },
  };
}
