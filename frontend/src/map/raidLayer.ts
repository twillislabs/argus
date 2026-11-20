// Air-raid alerts (/api/raids): Ukraine by oblast (a ring at the
// oblast's middle, dimmed for continuous alerts in occupied areas) and
// Israel by locality (bright while sounding, dim for the last 24 h).
// Pickable as "raid:<id>".

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import { LabelCollection, LabelStyle, PointPrimitiveCollection, type Scene, VerticalOrigin } from '@cesium/engine';

import type { RaidAlert } from '../lib/api';

export const RAID_COLOR = '#ff2d3d';
const LABEL_RANGE = new DistanceDisplayCondition(0, 4.0e6);

export interface RaidLayer {
  update: (alerts: RaidAlert[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addRaidLayer(scene: Scene): RaidLayer {
  const points = new PointPrimitiveCollection();
  const labels = new LabelCollection({ scene });
  scene.primitives.add(points);
  scene.primitives.add(labels);
  let depth = 0;
  const red = Color.fromCssColorString(RAID_COLOR);
  const dark = Color.fromCssColorString('#05080e');
  const scale = new NearFarScalar(3e5, 1.2, 1.5e7, 0.7);
  return {
    update(alerts, visible) {
      points.removeAll();
      labels.removeAll();
      if (!visible) return;
      for (const a of alerts) {
        const fresh = a.active && !a.long_running;
        const position = Cartesian3.fromDegrees(a.lon, a.lat, 2500);
        points.add({
          id: 'raid:' + a.id,
          position,
          pixelSize: fresh ? 14 : a.active ? 10 : 7,
          color: red.withAlpha(fresh ? 0.45 : 0.18),
          outlineColor: red.withAlpha(fresh ? 1 : 0.55),
          outlineWidth: fresh ? 2.5 : 1.5,
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
        });
        if (fresh) {
          labels.add({
            id: 'raid:' + a.id,
            position,
            text: a.name.replace(/ Oblast$/, ''),
            font: '600 11px Inter, system-ui, sans-serif',
            fillColor: red,
            outlineColor: dark,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -12),
            distanceDisplayCondition: LABEL_RANGE,
            disableDepthTestDistance: depth,
          });
        }
      }
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = metres;
      for (let i = 0; i < labels.length; i++) labels.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      for (const p of [points, labels])
        if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    },
  };
}
