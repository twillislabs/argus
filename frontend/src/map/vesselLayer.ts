// Vessels as hull glyphs turned to their heading (or course), coloured by
// category, with names for the selected one and close in.

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import {
  type Billboard,
  BillboardCollection,
  HorizontalOrigin,
  type Label,
  LabelCollection,
  LabelStyle,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { Vessel, VesselCategory } from '../lib/api';

export const VESSEL_COLOR: Record<VesselCategory, string> = {
  cargo: '#4fc1b0',
  tanker: '#e3c04b',
  passenger: '#8cc8ff',
  fishing: '#b49cff',
  military: '#ff5d8f',
  other: '#8391a5',
};

export interface SeaFilters {
  cargo: boolean;
  tanker: boolean;
  passenger: boolean;
  fishing: boolean;
  military: boolean;
  other: boolean;
}

export const DEFAULT_SEA: SeaFilters = {
  cargo: true,
  tanker: true,
  passenger: true,
  fishing: true,
  military: true,
  other: false,
};

const DEG = Math.PI / 180;

// A hull pointing north: pointed bow, square stern; white so the
// billboard colour tints it.
function hullImage(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 48;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.beginPath();
  ctx.moveTo(16, 3);
  ctx.bezierCurveTo(24, 14, 25, 22, 25, 30);
  ctx.lineTo(25, 44);
  ctx.lineTo(7, 44);
  ctx.lineTo(7, 30);
  ctx.bezierCurveTo(7, 22, 8, 14, 16, 3);
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(5,8,14,0.9)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return c;
}

// Moored or stopped: a dot, since there's no meaningful heading.
function dotImage(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.beginPath();
  ctx.arc(12, 12, 8, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(5,8,14,0.9)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return c;
}

export interface VesselLayer {
  update: (list: Vessel[], selected: number | null) => void;
  // Hide one vessel's glyph (its 3D model is showing instead).
  setHidden: (mmsi: number | null) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addVesselLayer(scene: Scene): VesselLayer {
  const hull = hullImage();
  const dot = dotImage();
  const billboards = new BillboardCollection({ scene });
  const labels = new LabelCollection({ scene });
  scene.primitives.add(billboards);
  scene.primitives.add(labels);
  // image: which glyph the billboard has, so it's only replaced when it
  // changes (setting an image adds it to the texture atlas again).
  const byMmsi = new Map<number, { bb: Billboard; label: Label | null; image: HTMLCanvasElement }>();
  const scale = new NearFarScalar(5.0e4, 1.0, 8.0e6, 0.35);
  const labelRange = new DistanceDisplayCondition(0, 1.5e5);
  const always = new DistanceDisplayCondition(0, Number.MAX_VALUE);
  let depth = 0;
  let hidden: number | null = null;

  return {
    update(list, selected) {
      const seen = new Set<number>();
      for (const v of list) {
        seen.add(v.mmsi);
        const isSel = v.mmsi === selected;
        const moving = (v.sog ?? 0) > 0.5;
        const dir = v.heading ?? v.cog;
        const position = Cartesian3.fromDegrees(v.lon, v.lat, 20);
        const color = Color.fromCssColorString(isSel ? '#ffffff' : VESSEL_COLOR[v.category]);
        const image = moving && dir !== null ? hull : dot;
        const w = isSel ? 18 : moving ? 11 : 8;
        const h = image === hull ? w * 1.5 : w;
        let item = byMmsi.get(v.mmsi);
        if (!item) {
          item = {
            bb: billboards.add({
              id: 'ship:' + v.mmsi,
              image,
              position,
              rotation: -(dir ?? 0) * DEG,
              alignedAxis: Cartesian3.UNIT_Z,
              width: w,
              height: h,
              color,
              scaleByDistance: scale,
              disableDepthTestDistance: depth,
            }),
            label: null,
            image,
          };
          byMmsi.set(v.mmsi, item);
        } else {
          item.bb.position = position;
          if (item.image !== image) {
            item.bb.image = image as unknown as string;
            item.image = image;
          }
          item.bb.rotation = -(dir ?? 0) * DEG;
          item.bb.width = w;
          item.bb.height = h;
          item.bb.color = color;
        }
        const text = v.name || (isSel ? 'MMSI ' + v.mmsi : null);
        if (text && !item.label) {
          item.label = labels.add({
            id: 'ship:' + v.mmsi,
            position,
            text,
            font: '500 10.5px "JetBrains Mono", monospace',
            fillColor: Color.fromCssColorString(isSel ? '#ffffff' : VESSEL_COLOR[v.category]),
            outlineColor: Color.fromCssColorString('#05080e'),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(10, 0),
            distanceDisplayCondition: isSel ? always : labelRange,
            disableDepthTestDistance: depth,
          });
        } else if (item.label) {
          item.label.position = position;
          item.label.distanceDisplayCondition = isSel ? always : labelRange;
        }
      }
      for (const [mmsi, item] of byMmsi) {
        item.bb.show = mmsi !== hidden;
        if (seen.has(mmsi)) continue;
        billboards.remove(item.bb);
        if (item.label) labels.remove(item.label);
        byMmsi.delete(mmsi);
      }
    },
    setHidden(mmsi) {
      if (mmsi === hidden) return;
      hidden = mmsi;
      for (const [m, item] of byMmsi) item.bb.show = m !== mmsi;
    },
    setDepthDistance(metres) {
      if (metres === depth) return;
      depth = metres;
      for (const item of byMmsi.values()) {
        item.bb.disableDepthTestDistance = metres;
        if (item.label) item.label.disableDepthTestDistance = metres;
      }
    },
    destroy() {
      if (scene.isDestroyed()) return;
      for (const p of [billboards, labels]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
