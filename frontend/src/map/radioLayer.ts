// World radio (/api/radio): each station where Radio Browser places it, a
// small round mast; stations close together merge into a count badge
// zoomed out (map/groups.ts). Pickable as "radio:<station uuid>".

import { Cartesian3, NearFarScalar } from '@cesium/core';
import { BillboardCollection, type Scene } from '@cesium/engine';

import type { RadioStation } from '../lib/api';
import { cellFor, groupBillboard, groupByCell, onCellChange } from './groups';

export const RADIO_COLOR = '#c792ff';

function icon(): HTMLCanvasElement {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const m = px / 2;
  // Waves either side of a dot.
  ctx.strokeStyle = RADIO_COLOR;
  ctx.lineWidth = 2;
  for (const r of [7, 11]) {
    ctx.beginPath();
    ctx.arc(m, m, r, -Math.PI / 4, Math.PI / 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m, m, r, (3 * Math.PI) / 4, (5 * Math.PI) / 4);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(m, m, 3.5, 0, 2 * Math.PI);
  ctx.fillStyle = RADIO_COLOR;
  ctx.fill();
  return c;
}

export interface RadioLayer {
  update: (stations: RadioStation[], visible: boolean, selected: string | null) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

export function addRadioLayer(scene: Scene): RadioLayer {
  const billboards = new BillboardCollection({ scene });
  scene.primitives.add(billboards);
  const image = icon();
  const scale = new NearFarScalar(1e4, 1, 2e7, 0.55);
  let depth = 0;
  let shown: RadioStation[] = [];
  let isVisible = false;
  let picked: string | null = null;
  let cell = cellFor(scene);
  const draw = () => {
    billboards.removeAll();
    if (isVisible) {
      const { alone, groups } = groupByCell(shown, cell, picked);
      for (const s of alone) {
        billboards.add({
          id: 'radio:' + s.id,
          position: Cartesian3.fromDegrees(s.lon, s.lat, 30),
          image,
          scale: s.id === picked ? 1.4 : 1,
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
        });
      }
      for (const list of groups) billboards.add(groupBillboard(list, 'radio:', RADIO_COLOR, depth));
    }
    scene.requestRender();
  };
  const stopListening = onCellChange(scene, (next) => {
    cell = next;
    if (isVisible) draw();
  });
  return {
    update(stations, visible, selected) {
      shown = stations;
      isVisible = visible;
      picked = selected;
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
