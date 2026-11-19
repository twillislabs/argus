// Traffic cameras (agency CCTV): a small camera glyph, with a wedge for
// the direction it looks where the agency says. Pickable as "cam:<id>".

import { Cartesian3, NearFarScalar } from '@cesium/core';
import { BillboardCollection, type Scene } from '@cesium/engine';

import type { TrafficCam } from '../lib/api';

export const CAM_COLOR = '#5fd0ff';
const DEG = Math.PI / 180;

export const WEBCAM_COLOR = '#7ee08a';

function icon(wedge: boolean, color = CAM_COLOR): HTMLCanvasElement {
  const px = 48;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const m = px / 2;
  if (wedge) {
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.arc(m, m, m - 2, -Math.PI / 2 - 28 * DEG, -Math.PI / 2 + 28 * DEG);
    ctx.closePath();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Camera body: a rounded box with a lens.
  ctx.fillStyle = '#0b0e13';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(m - 7, m - 5, 14, 10, 2.5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(m, m, 2.2, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  return c;
}

// Anything with a position, an id and maybe a facing.
type Placed = Pick<TrafficCam, 'id' | 'lat' | 'lon'> & { direction?: number | null };

export interface CamLayer {
  update: (cams: Placed[], visible: boolean, selected: string | null) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

// prefix: the pick id's ("cam:" for traffic cameras, "webcam:" for Windy).
export function addCamLayer(scene: Scene, color = CAM_COLOR, prefix = 'cam:'): CamLayer {
  const billboards = new BillboardCollection({ scene });
  scene.primitives.add(billboards);
  const withWedge = icon(true, color);
  const plain = icon(false, color);
  const scale = new NearFarScalar(2e3, 0.9, 2e5, 0.4);
  let depth = 0;
  return {
    update(cams, visible, selected) {
      billboards.removeAll();
      if (!visible) return;
      for (const c of cams) {
        const facing = c.direction !== null && c.direction !== undefined;
        billboards.add({
          id: prefix + c.id,
          position: Cartesian3.fromDegrees(c.lon, c.lat, 40),
          image: facing ? withWedge : plain,
          rotation: facing ? -(c.direction ?? 0) * DEG : 0,
          alignedAxis: Cartesian3.UNIT_Z,
          scale: c.id === selected ? 1.4 : 1,
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
        });
      }
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < billboards.length; i++) billboards.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      if (!scene.isDestroyed() && scene.primitives.contains(billboards)) scene.primitives.remove(billboards);
    },
  };
}
