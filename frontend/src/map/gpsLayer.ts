// GPS interference cells: hexagons about 55 km across, shaded by the share
// of aircraft reporting a degraded position. Cells under 2% (gpsjam.org's
// "low") are left clear; above that the fill deepens with the share, and
// cells over 10% are marked high.

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineGeometry,
} from '@cesium/core';
import { PerInstanceColorAppearance, PolylineColorAppearance, Primitive, type Scene } from '@cesium/engine';

import type { GpsCell } from '../lib/api';

export const GPS_COLOR = '#ff6ba1';
const HEIGHT = 1100;

function ring(c: GpsCell): number[] {
  const out: number[] = [];
  const k = Math.cos((c.lat * Math.PI) / 180) || 0.05;
  for (let i = 0; i <= 6; i++) {
    const a = ((60 * (i % 6) + 30) * Math.PI) / 180;
    out.push(c.lon + (Math.cos(a) * c.r) / k, c.lat + Math.sin(a) * c.r, HEIGHT);
  }
  return out;
}

export interface GpsLayer {
  update: (cells: GpsCell[], visible: boolean) => void;
  destroy: () => void;
}

export function addGpsLayer(scene: Scene): GpsLayer {
  let prims: Primitive[] = [];
  const clear = () => {
    for (const p of prims) if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    prims = [];
  };
  return {
    update(cells, visible) {
      clear();
      const shown = visible ? cells.filter((c) => c.level !== 'low') : [];
      if (!shown.length) return;
      const base = Color.fromCssColorString(GPS_COLOR);
      // Fill strength follows the share: 2% faint, 30% and over strongest.
      const alpha = (c: GpsCell) => 0.1 + Math.min(1, c.share / 0.3) * 0.32;
      const fill = new Primitive({
        geometryInstances: shown.map(
          (c) =>
            new GeometryInstance({
              id: 'gps:' + c.id,
              geometry: new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArrayHeights(ring(c))),
                height: HEIGHT,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(base.withAlpha(alpha(c))) },
            }),
        ),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      });
      const edge = new Primitive({
        geometryInstances: shown.map(
          (c) =>
            new GeometryInstance({
              geometry: new PolylineGeometry({
                positions: Cartesian3.fromDegreesArrayHeights(ring(c)),
                width: 1,
                vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
              }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(base.withAlpha(0.35)) },
            }),
        ),
        appearance: new PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
      });
      prims = [fill, edge];
      for (const p of prims) scene.primitives.add(p);
    },
    destroy: clear,
  };
}
