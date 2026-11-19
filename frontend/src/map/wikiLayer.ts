// Wikipedia current events (the last few days) as small markers at the
// most specific place each entry links: a ring for armed conflicts and
// attacks, a dot for everything else. Pickable as "wiki:<id>".

import { Cartesian3, Color, NearFarScalar } from '@cesium/core';
import { PointPrimitiveCollection, type Scene } from '@cesium/engine';

import type { WikiItem } from '../lib/api';

export const WIKI_COLOR = '#d9dde3';
export const WIKI_CONFLICT_COLOR = '#ff8a95';

export interface WikiLayer {
  update: (items: WikiItem[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addWikiLayer(scene: Scene): WikiLayer {
  const points = new PointPrimitiveCollection();
  scene.primitives.add(points);
  let depth = 0;
  const dark = Color.fromCssColorString('#05080e');
  const scale = new NearFarScalar(3e5, 1.2, 2e7, 0.75);
  return {
    update(items, visible) {
      points.removeAll();
      if (!visible) return;
      for (const it of items) {
        if (it.lat === null || it.lon === null) continue;
        const conflict = it.category.startsWith('Armed conflicts');
        points.add({
          id: 'wiki:' + it.id,
          position: Cartesian3.fromDegrees(it.lon, it.lat, 1500),
          pixelSize: conflict ? 7 : 6,
          color: conflict ? dark : Color.fromCssColorString(WIKI_COLOR),
          outlineColor: conflict ? Color.fromCssColorString(WIKI_CONFLICT_COLOR) : dark,
          outlineWidth: conflict ? 2 : 1.5,
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
        });
      }
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      if (!scene.isDestroyed() && scene.primitives.contains(points)) scene.primitives.remove(points);
    },
  };
}
