// Automatic licence plate reader cameras (OpenStreetMap / DeFlock): a
// small camera dot, with a wedge for the way it faces where that's
// mapped. Pickable as "alpr:<osm type/id>". Locations only. Zoomed
// out, cameras close together merge into a count badge (map/groups.ts).

import { Cartesian3, NearFarScalar } from '@cesium/core';
import { BillboardCollection, type Scene } from '@cesium/engine';

import type { AlprCamera } from '../lib/api';
import { cellFor, groupBillboard, groupByCell, onCellChange } from './groups';

export const ALPR_COLOR = '#ffb03a';
const DEG = Math.PI / 180;

function icon(wedge: boolean): HTMLCanvasElement {
  const px = 48;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const m = px / 2;
  if (wedge) {
    // A 70-degree cone pointing up (north before rotation).
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.arc(m, m, m - 2, -Math.PI / 2 - 35 * DEG, -Math.PI / 2 + 35 * DEG);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 176, 58, 0.32)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 176, 58, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(m, m, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#0b0e13';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = ALPR_COLOR;
  ctx.stroke();
  return c;
}

export interface AlprLayer {
  update: (cameras: AlprCamera[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addAlprLayer(scene: Scene): AlprLayer {
  const billboards = new BillboardCollection({ scene });
  scene.primitives.add(billboards);
  const withWedge = icon(true);
  const plain = icon(false);
  const scale = new NearFarScalar(2e3, 0.85, 1.5e5, 0.32);
  let depth = 0;
  let shown: AlprCamera[] = [];
  let isVisible = false;
  let cell = cellFor(scene);
  const draw = () => {
    billboards.removeAll();
    if (!isVisible) return;
    const { alone, groups } = groupByCell(shown, cell);
    for (const c of alone) {
      const facing = c.direction !== null;
      billboards.add({
        id: 'alpr:' + c.id,
        position: Cartesian3.fromDegrees(c.lon, c.lat, 30),
        image: facing ? withWedge : plain,
        rotation: facing ? -(c.direction ?? 0) * DEG : 0,
        alignedAxis: Cartesian3.UNIT_Z,
        scaleByDistance: scale,
        disableDepthTestDistance: depth,
      });
    }
    for (const list of groups) billboards.add(groupBillboard(list, 'alpr:', ALPR_COLOR, depth));
    scene.requestRender();
  };
  const stopListening = onCellChange(scene, (next) => {
    cell = next;
    if (isVisible) draw();
  });
  return {
    update(cameras, visible) {
      shown = cameras;
      isVisible = visible;
      cell = cellFor(scene);
      draw();
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < billboards.length; i++) billboards.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      stopListening();
      if (!scene.isDestroyed() && scene.primitives.contains(billboards)) scene.primitives.remove(billboards);
    },
  };
}
