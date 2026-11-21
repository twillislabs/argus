// Public transport (/api/transit): each vehicle an operator reports, as
// a small arrow pointing the way it's heading (a dot when the feed
// doesn't say). Pickable as "transit:<operator>:<vehicle>" for the hover
// card. Refreshed every 20 seconds while on, for a city-sized view.

import { Cartesian3, NearFarScalar } from '@cesium/core';
import { BillboardCollection, type Scene } from '@cesium/engine';

import type { TransitVehicle } from '../lib/api';

export const TRANSIT_COLOR = '#ffd166';
const DEG = Math.PI / 180;

function icon(arrow: boolean): HTMLCanvasElement {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const m = px / 2;
  ctx.fillStyle = TRANSIT_COLOR;
  ctx.strokeStyle = '#0b0e13';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (arrow) {
    // Pointing up (north before rotation).
    ctx.moveTo(m, 5);
    ctx.lineTo(m + 7, m + 9);
    ctx.lineTo(m, m + 5);
    ctx.lineTo(m - 7, m + 9);
    ctx.closePath();
  } else {
    ctx.arc(m, m, 5, 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.fill();
  return c;
}

export interface TransitLayer {
  update: (vehicles: TransitVehicle[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addTransitLayer(scene: Scene): TransitLayer {
  const billboards = new BillboardCollection({ scene });
  scene.primitives.add(billboards);
  const arrow = icon(true);
  const dot = icon(false);
  const scale = new NearFarScalar(1e3, 0.9, 1.5e5, 0.35);
  let depth = 0;
  return {
    update(vehicles, visible) {
      billboards.removeAll();
      if (visible) {
        for (const v of vehicles) {
          const heading = v.bearing !== null;
          billboards.add({
            id: 'transit:' + v.id,
            position: Cartesian3.fromDegrees(v.lon, v.lat, 20),
            image: heading ? arrow : dot,
            rotation: heading ? -(v.bearing ?? 0) * DEG : 0,
            alignedAxis: Cartesian3.UNIT_Z,
            scaleByDistance: scale,
            disableDepthTestDistance: depth,
          });
        }
      }
      scene.requestRender();
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
