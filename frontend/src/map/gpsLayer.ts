// GPS interference cells: yellow where 2-10% of aircraft report a
// degraded position, red above 10% (gpsjam.org's levels). Low cells are
// left clear.

import { Color, ColorGeometryInstanceAttribute, GeometryInstance, Rectangle, RectangleGeometry } from '@cesium/core';
import { PerInstanceColorAppearance, Primitive, type Scene } from '@cesium/engine';

import type { GpsCell } from '../lib/api';

export const GPS_COLOR = { medium: '#e3c04b', high: '#ff5260' };

export interface GpsLayer {
  update: (cells: GpsCell[], visible: boolean) => void;
  destroy: () => void;
}

export function addGpsLayer(scene: Scene): GpsLayer {
  let prim: Primitive | null = null;
  const clear = () => {
    if (prim && !scene.isDestroyed() && scene.primitives.contains(prim)) scene.primitives.remove(prim);
    prim = null;
  };
  return {
    update(cells, visible) {
      clear();
      const shown = visible ? cells.filter((c) => c.level !== 'low') : [];
      if (!shown.length) return;
      prim = new Primitive({
        geometryInstances: shown.map(
          (c) =>
            new GeometryInstance({
              id: 'gps:' + c.lat + ',' + c.lon,
              geometry: new RectangleGeometry({
                rectangle: Rectangle.fromDegrees(c.lon, c.lat, c.lon + c.size, c.lat + c.size),
                height: 1100,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              attributes: {
                color: ColorGeometryInstanceAttribute.fromColor(
                  Color.fromCssColorString(GPS_COLOR[c.level as 'medium' | 'high']).withAlpha(0.28),
                ),
              },
            }),
        ),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      });
      scene.primitives.add(prim);
    },
    destroy: clear,
  };
}
