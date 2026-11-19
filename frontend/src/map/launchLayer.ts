// Rocket launches (Launch Library 2): a marker at each launch's pad,
// coloured by status, with its rocket's name close in. Upcoming
// launches in the next 48 hours get a ring. Pickable as "launch:<id>".

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import {
  BillboardCollection,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { Launch } from '../lib/api';

export const LAUNCH_COLOR = {
  soon: '#ffd166', // next 48 hours
  upcoming: '#c9a2ff',
  success: '#4fd18b',
  failure: '#ff5260',
  other: '#9aa7ba',
};

export function launchColor(l: Launch, now = Date.now()): string {
  const t = l.net ? Date.parse(l.net) : NaN;
  const s = l.status.toLowerCase();
  if (s === 'success') return LAUNCH_COLOR.success;
  if (s.includes('fail')) return LAUNCH_COLOR.failure;
  if (Number.isFinite(t) && t >= now) return t - now < 48 * 3600_000 ? LAUNCH_COLOR.soon : LAUNCH_COLOR.upcoming;
  return LAUNCH_COLOR.other;
}

export const padKey = (l: Launch) => l.lat.toFixed(3) + ',' + l.lon.toFixed(3);

// Launches grouped by pad, each group in time order.
export function byPad(items: Launch[]): Map<string, Launch[]> {
  const out = new Map<string, Launch[]>();
  for (const l of [...items].sort((a, b) => (a.net ?? '').localeCompare(b.net ?? ''))) {
    const list = out.get(padKey(l)) ?? [];
    list.push(l);
    out.set(padKey(l), list);
  }
  return out;
}

// The launch a pad's marker shows: its next one, else its latest.
export function padLead(group: Launch[], now = Date.now()): Launch {
  return group.find((l) => l.net && Date.parse(l.net) >= now) ?? group[group.length - 1];
}

export interface LaunchLayer {
  update: (items: Launch[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

const LABEL_RANGE = new DistanceDisplayCondition(0, 3.0e6);

// A small rocket, so launches don't read as event dots. Soon: ringed.
function rocket(color: string, ring: boolean): HTMLCanvasElement {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  if (!g) return c;
  if (ring) {
    g.beginPath();
    g.arc(16, 16, 14, 0, 2 * Math.PI);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();
  }
  g.beginPath();
  g.moveTo(16, 5); // nose
  g.quadraticCurveTo(21, 10, 20, 20);
  g.lineTo(23, 25); // fins
  g.lineTo(9, 25);
  g.lineTo(12, 20);
  g.quadraticCurveTo(11, 10, 16, 5);
  g.closePath();
  g.fillStyle = color;
  g.strokeStyle = '#05080e';
  g.lineWidth = 1.5;
  g.fill();
  g.stroke();
  return c;
}

export function addLaunchLayer(scene: Scene): LaunchLayer {
  const points = new BillboardCollection({ scene });
  const labels = new LabelCollection({ scene });
  scene.primitives.add(points);
  const icons = new Map<string, HTMLCanvasElement>();
  const icon = (color: string, ring: boolean) => {
    const key = color + ring;
    if (!icons.has(key)) icons.set(key, rocket(color, ring));
    return icons.get(key) as HTMLCanvasElement;
  };
  scene.primitives.add(labels);
  let depth = 0;
  const dark = Color.fromCssColorString('#05080e');
  const scale = new NearFarScalar(3e5, 1.0, 2e7, 0.7);
  return {
    update(items, visible) {
      points.removeAll();
      labels.removeAll();
      if (!visible) return;
      const now = Date.now();
      for (const group of byPad(items).values()) {
        const l = padLead(group, now);
        const position = Cartesian3.fromDegrees(l.lon, l.lat, 2000);
        const color = Color.fromCssColorString(launchColor(l, now));
        const soon = launchColor(l, now) === LAUNCH_COLOR.soon;
        points.add({
          id: 'launch:' + l.id,
          position,
          image: icon(launchColor(l, now), soon),
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
        });
        labels.add({
          id: 'launch:' + l.id,
          position,
          text: (l.rocket ?? l.name).slice(0, 40) + (group.length > 1 ? ' +' + (group.length - 1) : ''),
          font: '500 10.5px Inter, system-ui, sans-serif',
          fillColor: color,
          outlineColor: dark,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(9, 0),
          distanceDisplayCondition: LABEL_RANGE,
          disableDepthTestDistance: depth,
        });
      }
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = metres;
      for (let i = 0; i < labels.length; i++) labels.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      for (const p of [points, labels])
        if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    },
  };
}
