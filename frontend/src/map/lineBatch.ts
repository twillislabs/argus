// Many static lines drawn as one primitive: a single draw call however
// many lines there are (state borders are some 44,000). Colour can still
// change, line by line, through per-instance attributes.

import {
  ArcType,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  type DistanceDisplayCondition,
  DistanceDisplayConditionGeometryInstanceAttribute,
  GeometryInstance,
  PolylineGeometry,
} from '@cesium/core';
import { PolylineColorAppearance, Primitive, type Scene } from '@cesium/engine';

export interface LineBatch {
  primitive: Primitive;
  setColor: (css: string) => void;
}

// lines: [lon, lat] points; height in metres above the ellipsoid.
export function lineBatch(
  scene: Scene,
  lines: number[][][],
  css: string,
  width: number,
  height: number,
  range?: DistanceDisplayCondition,
): LineBatch {
  const color = Color.fromCssColorString(css);
  const instances: GeometryInstance[] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const flat: number[] = [];
    for (const [lon, lat] of line) flat.push(lon, lat, height);
    instances.push(
      new GeometryInstance({
        id: instances.length,
        geometry: new PolylineGeometry({
          positions: Cartesian3.fromDegreesArrayHeights(flat),
          width,
          arcType: ArcType.GEODESIC,
          vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(color),
          ...(range
            ? {
                distanceDisplayCondition:
                  DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(range),
              }
            : {}),
        },
      }),
    );
  }
  const count = instances.length;
  const primitive = new Primitive({
    geometryInstances: instances,
    appearance: new PolylineColorAppearance({ translucent: true }),
    asynchronous: true,
    allowPicking: false,
  });
  let pending: Color | null = null;
  const apply = (c: Color) => {
    for (let i = 0; i < count; i++) {
      const a = primitive.getGeometryInstanceAttributes(i);
      if (a) a.color = ColorGeometryInstanceAttribute.toValue(c, a.color);
    }
  };
  // A colour set before the geometry is built is applied once it is.
  let unwatch: (() => void) | null = null;
  return {
    primitive,
    setColor(next) {
      const c = Color.fromCssColorString(next);
      if (primitive.ready) {
        apply(c);
        return;
      }
      pending = c;
      unwatch ??= scene.postRender.addEventListener(() => {
        if (primitive.isDestroyed()) {
          unwatch?.();
          unwatch = null;
        } else if (primitive.ready && pending) {
          apply(pending);
          pending = null;
          unwatch?.();
          unwatch = null;
        }
      });
    },
  };
}
