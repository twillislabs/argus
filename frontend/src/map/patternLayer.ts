// Behaviour patterns (/api/patterns): a ring around each aircraft orbit
// or racetrack and each ship loitering near a cable, sized to it.

import type { Primitive, Scene } from '@cesium/engine';

import type { Patterns } from '../lib/api';
import { circleRing } from '../lib/geo';
import { lineBatch } from './lineBatch';

export const PATTERN_COLOR = { air: '#ffb547', sea: '#ff7a59' };

export interface PatternLayer {
  update: (p: Patterns | null, showAir: boolean, showSea: boolean) => void;
  destroy: () => void;
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
      const air = showAir ? p.air.map((a) => circleRing([a.lon, a.lat], Math.max(5, a.radius_km * 1.15))) : [];
      const sea = showSea ? p.sea.map((s) => circleRing([s.lon, s.lat], 5)) : [];
      if (air.length) prims.push(lineBatch(scene, air, PATTERN_COLOR.air, 2, 9000).primitive);
      if (sea.length) prims.push(lineBatch(scene, sea, PATTERN_COLOR.sea, 2, 800).primitive);
      for (const pr of prims) scene.primitives.add(pr);
    },
    destroy: clear,
  };
}
