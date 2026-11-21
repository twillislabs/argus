// Behaviour patterns (/api/patterns): a ring around each aircraft orbit
// or racetrack and each ship loitering near a cable, sized to it.
//
// Clicking or hovering a ring is the same as the aircraft ("ac:<hex>") or
// ship ("ship:<mmsi>") it's about. A 2 px line is hard to hit, so each
// ring has a wide, all but invisible twin that only the picker sees.

import {
  ArcType,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PolylineGeometry,
} from '@cesium/core';
import { PolylineColorAppearance, Primitive, type Scene } from '@cesium/engine';

import type { Patterns } from '../lib/api';
import { circleRing } from '../lib/geo';
import { lineBatch } from './lineBatch';

export const PATTERN_COLOR = { air: '#ffb547', sea: '#ff7a59' };

// Width of the hit ring in pixels, and its alpha: low enough not to show,
// above 0, which the pick shader discards.
const HIT_PX = 14;
const HIT_ALPHA = 0.01;

export interface PatternLayer {
  update: (p: Patterns | null, showAir: boolean, showSea: boolean) => void;
  destroy: () => void;
}

interface Ring {
  id: string;
  line: number[][];
  height: number;
}

function hitRings(rings: Ring[]): Primitive {
  const color = ColorGeometryInstanceAttribute.fromColor(Color.WHITE.withAlpha(HIT_ALPHA));
  return new Primitive({
    geometryInstances: rings.map(
      (r) =>
        new GeometryInstance({
          id: r.id,
          geometry: new PolylineGeometry({
            positions: Cartesian3.fromDegreesArrayHeights(r.line.flatMap(([lon, lat]) => [lon, lat, r.height])),
            width: HIT_PX,
            arcType: ArcType.GEODESIC,
            vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color },
        }),
    ),
    appearance: new PolylineColorAppearance({ translucent: true }),
    asynchronous: true,
  });
}

export function addPatternLayer(scene: Scene): PatternLayer {
  let prims: Primitive[] = [];
  const clear = () => {
    for (const p of prims) if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    prims = [];
  };
  return {
    update(p, showAir, showSea) {
      clear();
      if (!p) return;
      const air: Ring[] = showAir
        ? p.air.map((a) => ({
            id: 'ac:' + a.hex,
            line: circleRing([a.lon, a.lat], Math.max(5, a.radius_km * 1.15)),
            height: 9000,
          }))
        : [];
      const sea: Ring[] = showSea
        ? p.sea.map((s) => ({ id: 'ship:' + s.mmsi, line: circleRing([s.lon, s.lat], 5), height: 800 }))
        : [];
      if (air.length)
        prims.push(
          lineBatch(
            scene,
            air.map((r) => r.line),
            PATTERN_COLOR.air,
            2,
            9000,
          ).primitive,
        );
      if (sea.length)
        prims.push(
          lineBatch(
            scene,
            sea.map((r) => r.line),
            PATTERN_COLOR.sea,
            2,
            800,
          ).primitive,
        );
      if (air.length || sea.length) prims.push(hitRings([...air, ...sea]));
      for (const pr of prims) scene.primitives.add(pr);
    },
    destroy: clear,
  };
}
