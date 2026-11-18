// Aircraft on the globe: a plane glyph per aircraft, turned to its track,
// with callsign labels for military and selected aircraft and a trail for
// the selected one. Billboards are keyed by hex and updated in place.

import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
} from '@cesium/core';
import {
  type Billboard,
  BillboardCollection,
  HorizontalOrigin,
  type Label,
  LabelCollection,
  LabelStyle,
  Material,
  type Polyline,
  PolylineCollection,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { Aircraft } from '../lib/api';

export const AIR_COLOR = {
  military: '#8cc8ff',
  civil: '#8391a5',
  emergency: '#ff5260',
  selected: '#ffffff',
  trail: '#8cc8ff',
};

const FT_TO_M = 0.3048;
const DEG = Math.PI / 180;

// A plane silhouette pointing north, white so the billboard colour tints it.
function planeImage(): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 40, size / 40);
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.bezierCurveTo(1.6, -17, 2.2, -14, 2.2, -11);
  ctx.lineTo(2.2, -4);
  ctx.lineTo(16, 4);
  ctx.lineTo(16, 7);
  ctx.lineTo(2.2, 2.5);
  ctx.lineTo(2, 11);
  ctx.lineTo(6.5, 14.5);
  ctx.lineTo(6.5, 17);
  ctx.lineTo(0, 15);
  ctx.lineTo(-6.5, 17);
  ctx.lineTo(-6.5, 14.5);
  ctx.lineTo(-2, 11);
  ctx.lineTo(-2.2, 2.5);
  ctx.lineTo(-16, 7);
  ctx.lineTo(-16, 4);
  ctx.lineTo(-2.2, -4);
  ctx.lineTo(-2.2, -11);
  ctx.bezierCurveTo(-2.2, -14, -1.6, -17, 0, -17);
  ctx.closePath();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(5,8,14,0.9)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return c;
}

export function aircraftColor(a: Aircraft): string {
  if (a.emergency) return AIR_COLOR.emergency;
  return a.mil ? AIR_COLOR.military : AIR_COLOR.civil;
}

export function aircraftPosition(a: Aircraft): Cartesian3 {
  return Cartesian3.fromDegrees(a.lon, a.lat, Math.max(0, (a.alt_ft ?? 0) * FT_TO_M));
}

export interface AircraftLayer {
  update: (list: Aircraft[], selectedHex: string | null) => void;
  setTrail: (points: number[][] | null) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function addAircraftLayer(scene: Scene): AircraftLayer {
  const image = planeImage();
  const billboards = new BillboardCollection({ scene });
  const labels = new LabelCollection({ scene });
  const trails = new PolylineCollection();
  scene.primitives.add(trails);
  scene.primitives.add(billboards);
  scene.primitives.add(labels);

  const byHex = new Map<string, { bb: Billboard; label: Label | null }>();
  const scale = new NearFarScalar(1.5e5, 1.0, 1.5e7, 0.45);
  const labelRange = new DistanceDisplayCondition(0, 2.5e6);
  const always = new DistanceDisplayCondition(0, Number.MAX_VALUE);
  let trail: Polyline | null = null;

  function labelFor(a: Aircraft, selected: boolean): string | null {
    if (!selected && !a.mil && !a.emergency) return null;
    return a.callsign || a.reg || a.hex.toUpperCase();
  }

  return {
    update(list, selectedHex) {
      const seen = new Set<string>();
      for (const a of list) {
        seen.add(a.hex);
        const selected = a.hex === selectedHex;
        const color = Color.fromCssColorString(selected ? AIR_COLOR.selected : aircraftColor(a));
        const position = aircraftPosition(a);
        const rotation = -(a.track ?? 0) * DEG;
        const size = selected ? 26 : a.mil || a.emergency ? 20 : 15;
        let item = byHex.get(a.hex);
        if (!item) {
          item = {
            bb: billboards.add({
              id: 'ac:' + a.hex,
              image,
              position,
              rotation,
              alignedAxis: Cartesian3.UNIT_Z,
              width: size,
              height: size,
              color,
              scaleByDistance: scale,
            }),
            label: null,
          };
          byHex.set(a.hex, item);
        } else {
          item.bb.position = position;
          item.bb.rotation = rotation;
          item.bb.color = color;
          item.bb.width = size;
          item.bb.height = size;
        }
        const text = labelFor(a, selected);
        if (text && !item.label) {
          item.label = labels.add({
            id: 'ac:' + a.hex,
            position,
            text,
            font: '500 11px "JetBrains Mono", monospace',
            fillColor: Color.fromCssColorString(selected ? '#ffffff' : AIR_COLOR.military),
            outlineColor: Color.fromCssColorString('#05080e'),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(13, 0),
            distanceDisplayCondition: selected ? always : labelRange,
          });
        } else if (text && item.label) {
          item.label.position = position;
          item.label.text = text;
          item.label.fillColor = Color.fromCssColorString(
            selected ? '#ffffff' : a.emergency ? AIR_COLOR.emergency : AIR_COLOR.military,
          );
          item.label.distanceDisplayCondition = selected ? always : labelRange;
        } else if (!text && item.label) {
          labels.remove(item.label);
          item.label = null;
        }
      }
      for (const [hex, item] of byHex) {
        if (seen.has(hex)) continue;
        billboards.remove(item.bb);
        if (item.label) labels.remove(item.label);
        byHex.delete(hex);
      }
    },
    setTrail(points) {
      if (!points || points.length < 2) {
        if (trail) trail.show = false;
        return;
      }
      const flat: number[] = [];
      for (const [lon, lat, alt] of points) flat.push(lon, lat, Math.max(0, alt * FT_TO_M));
      const positions = Cartesian3.fromDegreesArrayHeights(flat);
      if (!trail) {
        trail = trails.add({
          positions,
          width: 2,
          material: Material.fromType('Color', {
            color: Color.fromCssColorString(AIR_COLOR.trail).withAlpha(0.8),
          }),
        });
      } else {
        trail.positions = positions;
        trail.show = true;
      }
    },
    setVisible(visible) {
      billboards.show = visible;
      labels.show = visible;
      trails.show = visible;
    },
    destroy() {
      if (scene.isDestroyed()) return;
      for (const p of [trails, billboards, labels]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
