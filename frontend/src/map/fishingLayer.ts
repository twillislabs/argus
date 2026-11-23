// Global Fishing Watch events (/api/fishing): ships meeting at sea,
// loitering and AIS gaps over the last 30 days, a dot each, coloured by
// kind. Pickable as "gfw:<event id>" (hover card and info panel).

import { Cartesian3, Color, NearFarScalar } from '@cesium/core';
import { PointPrimitiveCollection, type Scene } from '@cesium/engine';

import type { FishingEvent } from '../lib/api';

export const FISHING_COLOR: Record<FishingEvent['kind'], string> = {
  encounter: '#ff5fd2',
  loitering: '#ffc94d',
  gap: '#ff4b4b',
};

export const FISHING_LABEL: Record<FishingEvent['kind'], string> = {
  encounter: 'Ships meeting at sea',
  loitering: 'Loitering',
  gap: 'AIS gap (went quiet)',
};

export interface FishingLayer {
  update: (events: FishingEvent[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addFishingLayer(scene: Scene): FishingLayer {
  const points = new PointPrimitiveCollection();
  scene.primitives.add(points);
  const scale = new NearFarScalar(2e4, 1.4, 6e6, 0.7);
  let depth = 0;
  return {
    update(events, visible) {
      points.removeAll();
      if (visible) {
        for (const e of events) {
          points.add({
            id: 'gfw:' + e.id,
            position: Cartesian3.fromDegrees(e.lon, e.lat, 40),
            pixelSize: e.kind === 'encounter' ? 9 : 7,
            color: Color.fromCssColorString(FISHING_COLOR[e.kind]),
            outlineColor: Color.BLACK.withAlpha(0.75),
            outlineWidth: 1.5,
            scaleByDistance: scale,
            disableDepthTestDistance: depth,
          });
        }
      }
      scene.requestRender();
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
