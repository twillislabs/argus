// Cyber on the map: countries with an internet outage in the last 24
// hours (IODA), tinted, stronger while it's ongoing ("outage:<cc>"), and
// ransomware victims per country over the last week (ransomware.live),
// a marker at the country's largest city sized by the count ("rw:<cc>").

import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  NearFarScalar,
  PolygonGeometry,
} from '@cesium/core';
import {
  LabelCollection,
  LabelStyle,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  Primitive,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { InternetOutage, RansomwareCountry } from '../lib/api';
import { hierarchy, loadShapes, naturalEarthName } from './tensionLayer';

export const OUTAGE_COLOR = '#b07cff';
export const RANSOMWARE_COLOR = '#ff7a59';
const HEIGHT = 750;

export interface CyberLayer {
  update: (outages: InternetOutage[], showOutages: boolean, ransom: RansomwareCountry[], showRansom: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addCyberLayer(scene: Scene): CyberLayer {
  let fill: Primitive | null = null;
  let version = 0;
  const points = new PointPrimitiveCollection();
  const labels = new LabelCollection({ scene });
  scene.primitives.add(points);
  scene.primitives.add(labels);
  let depth = 0;
  const dark = Color.fromCssColorString('#05080e');
  const ransom = Color.fromCssColorString(RANSOMWARE_COLOR);
  const scale = new NearFarScalar(5e5, 1.1, 2e7, 0.7);
  const dropFill = () => {
    if (fill && !scene.isDestroyed() && scene.primitives.contains(fill)) scene.primitives.remove(fill);
    fill = null;
  };
  return {
    update(outages, showOutages, rw, showRansom) {
      const mine = ++version;
      dropFill();
      points.removeAll();
      labels.removeAll();
      if (showRansom) {
        for (const r of rw) {
          const position = Cartesian3.fromDegrees(r.lon, r.lat, 3000);
          const size = Math.min(26, 8 + Math.sqrt(r.count) * 3);
          points.add({
            id: 'rw:' + r.cc,
            position,
            pixelSize: size,
            color: ransom.withAlpha(0.35),
            outlineColor: ransom,
            outlineWidth: 1.5,
            scaleByDistance: scale,
            disableDepthTestDistance: depth,
          });
          labels.add({
            id: 'rw:' + r.cc,
            position,
            text: String(r.count),
            font: '600 11px "JetBrains Mono", monospace',
            fillColor: Color.WHITE,
            outlineColor: dark,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(-4 * String(r.count).length, 0),
            scaleByDistance: scale,
            disableDepthTestDistance: depth,
          });
        }
      }
      if (!showOutages || !outages.length) return;
      void loadShapes().then((byName) => {
        if (mine !== version || scene.isDestroyed()) return;
        const base = Color.fromCssColorString(OUTAGE_COLOR);
        const instances: GeometryInstance[] = [];
        for (const o of outages) {
          const polys = byName.get(naturalEarthName(o.country ?? ''));
          if (!polys) continue;
          for (const rings of polys) {
            instances.push(
              new GeometryInstance({
                id: 'outage:' + o.cc,
                geometry: new PolygonGeometry({
                  polygonHierarchy: hierarchy(rings),
                  height: HEIGHT,
                  vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                  color: ColorGeometryInstanceAttribute.fromColor(base.withAlpha(o.ongoing ? 0.32 : 0.14)),
                },
              }),
            );
          }
        }
        if (!instances.length) return;
        fill = new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: true,
        });
        scene.primitives.add(fill);
      });
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = metres;
      for (let i = 0; i < labels.length; i++) labels.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      dropFill();
      for (const p of [points, labels])
        if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    },
  };
}
