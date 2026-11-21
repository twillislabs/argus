// Air quality (Open-Meteo / CAMS, /api/weather/air): a soft tint over the
// view coloured by US AQI category, with each point's index written on
// it. The points form a grid (its step comes with the data, finer when
// zoomed in); they're painted one pixel each on a small canvas that's
// stretched over the area, so the GPU blends between them.

import {
  Cartesian2,
  Cartesian3,
  Color,
  GeometryInstance,
  NearFarScalar,
  Rectangle,
  RectangleGeometry,
} from '@cesium/core';
import {
  EllipsoidSurfaceAppearance,
  LabelCollection,
  LabelStyle,
  Material,
  Primitive,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { AirPoint } from '../lib/api';

// US AQI categories (EPA), upper bounds inclusive.
export const AQI_BANDS: { upTo: number; color: string; label: string }[] = [
  { upTo: 50, color: '#4cc96b', label: 'Good' },
  { upTo: 100, color: '#f2d14b', label: 'Moderate' },
  { upTo: 150, color: '#ff9a3c', label: 'Unhealthy for sensitive groups' },
  { upTo: 200, color: '#ff4d4d', label: 'Unhealthy' },
  { upTo: 300, color: '#b061ff', label: 'Very unhealthy' },
  { upTo: Infinity, color: '#a0234a', label: 'Hazardous' },
];

export function aqiBand(aqi: number) {
  return AQI_BANDS.find((b) => aqi <= b.upTo) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

export interface AirLayer {
  update: (points: AirPoint[], step: number, visible: boolean) => void;
  destroy: () => void;
}

export function addAirLayer(scene: Scene): AirLayer {
  const labels = new LabelCollection({ scene });
  scene.primitives.add(labels);
  let cells: Primitive | null = null;
  let key = '';
  const drop = () => {
    if (cells && !scene.isDestroyed() && scene.primitives.contains(cells)) scene.primitives.remove(cells);
    cells = null;
  };
  return {
    update(points, step, visible) {
      const next = visible ? step + '|' + points.map((p) => p.lat + ',' + p.lon + '=' + p.us_aqi).join(';') : '';
      if (next === key) return;
      key = next;
      drop();
      labels.removeAll();
      if (!visible || !points.length) {
        scene.requestRender();
        return;
      }
      // One pixel per grid point, north row first.
      const lats = points.map((p) => p.lat);
      const lons = points.map((p) => p.lon);
      const s0 = Math.min(...lats);
      const n0 = Math.max(...lats);
      const w0 = Math.min(...lons);
      const e0 = Math.max(...lons);
      const cols = Math.round((e0 - w0) / step) + 1;
      const rows = Math.round((n0 - s0) / step) + 1;
      const canvas = document.createElement('canvas');
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      for (const p of points) {
        ctx.fillStyle = aqiBand(p.us_aqi).color;
        ctx.fillRect(Math.round((p.lon - w0) / step), Math.round((n0 - p.lat) / step), 1, 1);
      }
      // The pixels' centres sit on the points: the area runs half a
      // step past them.
      const half = step / 2;
      cells = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new RectangleGeometry({
            rectangle: Rectangle.fromDegrees(
              w0 - half,
              Math.max(-89.9, s0 - half),
              e0 + half,
              Math.min(89.9, n0 + half),
            ),
            vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT,
            granularity: Math.min(0.02, (step * Math.PI) / 180 / 4),
          }),
        }),
        appearance: new EllipsoidSurfaceAppearance({
          aboveGround: false,
          translucent: true,
          material: Material.fromType('Image', { image: canvas.toDataURL(), color: new Color(1, 1, 1, 0.26) }),
          // No depth test: the dark map's land shapes sit above the ground.
          renderState: { depthTest: { enabled: false } },
        }),
        asynchronous: true,
      });
      scene.primitives.add(cells);
      const far = Math.max(2e5, step * 4e6);
      for (const p of points) {
        labels.add({
          position: Cartesian3.fromDegrees(p.lon, p.lat, 50),
          text: String(Math.round(p.us_aqi)),
          font: '600 13px system-ui, sans-serif',
          fillColor: Color.fromCssColorString(aqiBand(p.us_aqi).color),
          outlineColor: Color.fromCssColorString('#0b0e13'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: Cartesian2.ZERO,
          scaleByDistance: new NearFarScalar(far / 20, 1, far * 4, 0.6),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
      scene.requestRender();
    },
    destroy() {
      drop();
      if (!scene.isDestroyed() && scene.primitives.contains(labels)) scene.primitives.remove(labels);
    },
  };
}
