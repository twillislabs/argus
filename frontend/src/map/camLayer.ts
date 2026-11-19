// Traffic cameras (agency CCTV): a small camera glyph, with a wedge for
// the direction it looks where the agency says. Pickable as "cam:<id>".

import { Cartesian3, NearFarScalar } from '@cesium/core';
import { BillboardCollection, type Scene } from '@cesium/engine';

import type { TrafficCam } from '../lib/api';

export const CAM_COLOR = '#5fd0ff';
const DEG = Math.PI / 180;

function icon(wedge: boolean): HTMLCanvasElement {
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
    ctx.fillStyle = 'rgba(95, 208, 255, 0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(95, 208, 255, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Camera body: a rounded box with a lens.
  ctx.fillStyle = '#0b0e13';
  ctx.strokeStyle = CAM_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(m - 7, m - 5, 14, 10, 2.5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(m, m, 2.2, 0, 2 * Math.PI);
  ctx.fillStyle = CAM_COLOR;
  ctx.fill();
  return c;
}

export interface CamLayer {
  update: (cams: TrafficCam[], visible: boolean, selected: string | null) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addCamLayer(scene: Scene): CamLayer {
  const billboards = new BillboardCollection({ scene });
  scene.primitives.add(billboards);
  const withWedge = icon(true);
  const plain = icon(false);
  const scale = new NearFarScalar(2e3, 0.9, 2e5, 0.4);
  let depth = 0;
  return {
    update(cams, visible, selected) {
      billboards.removeAll();
      if (!visible) return;
      for (const c of cams) {
        const facing = c.direction !== null;
        billboards.add({
          id: 'cam:' + c.id,
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
