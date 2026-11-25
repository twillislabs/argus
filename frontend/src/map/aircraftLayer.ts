// Aircraft on the globe: a plane glyph per aircraft, turned to its track,
// with callsign labels for military and selected aircraft and a trail for
// the selected one. Billboards are keyed by hex and updated in place.

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
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

const EARTH_M = 6_371_000;
const KT_TO_MS = 0.514444;
// Don't project further than this past the last report.
const MAX_PROJECT_S = 90;

// Dead reckoning: where the aircraft should be dt seconds after its last
// report, from its ground speed, track and vertical rate.
export function extrapolate(a: Aircraft, dt: number): { lon: number; lat: number; altM: number } {
  const t = Math.max(0, Math.min(MAX_PROJECT_S, dt));
  const altFt = (a.alt_ft ?? 0) + ((a.vrate ?? 0) / 60) * t;
  const altM = Math.max(0, altFt * FT_TO_M);
  if (a.ground || !a.gs_kt || a.track === null) return { lon: a.lon, lat: a.lat, altM };
  const delta = (a.gs_kt * KT_TO_MS * t) / EARTH_M;
  const theta = a.track * DEG;
  const phi1 = a.lat * DEG;
  const lambda1 = a.lon * DEG;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  const lon = ((((lambda2 / DEG + 540) % 360) + 360) % 360) - 180;
  return { lon, lat: phi2 / DEG, altM };
}

// Keep turning at the reported rate for at most this long (turns end).
const TURN_MAX_S = 25;

// Dead reckoning along an arc: like extrapolate, but the track keeps
// changing at turnDegS (degrees a second) for up to TURN_MAX_S. Also
// returns the track at that moment, for headings that follow the path.
export function extrapolateTurning(
  a: Aircraft,
  dt: number,
  turnDegS: number,
): { lon: number; lat: number; altM: number; track: number } {
  const t = Math.max(0, Math.min(MAX_PROJECT_S, dt));
  const track0 = a.track ?? 0;
  if (!turnDegS || a.ground || !a.gs_kt || a.track === null) {
    return { ...extrapolate(a, t), track: track0 };
  }
  // One-second steps along the arc, then straight on.
  const turning = Math.min(t, TURN_MAX_S);
  let cur: Aircraft = a;
  let done = 0;
  while (done < turning) {
    const step = Math.min(1, turning - done);
    const mid = (track0 + turnDegS * (done + step / 2) + 360) % 360;
    const p = extrapolate({ ...cur, track: mid, vrate: 0 }, step);
    cur = { ...cur, lat: p.lat, lon: p.lon };
    done += step;
  }
  const track = (track0 + turnDegS * turning + 360) % 360;
  const rest = extrapolate({ ...cur, track, vrate: 0 }, t - turning);
  return { lon: rest.lon, lat: rest.lat, altM: extrapolate(a, t).altM, track };
}

export interface AircraftLayer {
  update: (list: Aircraft[], selectedHex: string | null) => void;
  // Move one aircraft between reports (dead reckoning for the selected one).
  moveTo: (hex: string, position: Cartesian3) => void;
  // Hide one aircraft, for the cockpit view.
  setHidden: (hex: string | null) => void;
  // See Globe: depth testing only beyond this distance from the camera.
  setDepthDistance: (metres: number) => void;
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
  const labelRange = new DistanceDisplayCondition(0, 1.2e6);
  const always = new DistanceDisplayCondition(0, Number.MAX_VALUE);
  let trail: Polyline | null = null;
  let hidden: string | null = null;
  let depthDistance = 0;

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
              disableDepthTestDistance: depthDistance,
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
        item.bb.show = a.hex !== hidden;
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
            disableDepthTestDistance: depthDistance,
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
        if (item.label) item.label.show = a.hex !== hidden;
      }
      for (const [hex, item] of byHex) {
        if (seen.has(hex)) continue;
        billboards.remove(item.bb);
        if (item.label) labels.remove(item.label);
        byHex.delete(hex);
      }
    },
    moveTo(hex, position) {
      const item = byHex.get(hex);
      if (!item) return;
      item.bb.position = position;
      if (item.label) item.label.position = position;
    },
    setHidden(hex) {
      hidden = hex;
      for (const [h, item] of byHex) {
        item.bb.show = h !== hex;
        if (item.label) item.label.show = h !== hex;
      }
    },
    setDepthDistance(metres) {
      if (metres === depthDistance) return;
      depthDistance = metres;
      for (const item of byHex.values()) {
        item.bb.disableDepthTestDistance = metres;
        if (item.label) item.label.disableDepthTestDistance = metres;
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
