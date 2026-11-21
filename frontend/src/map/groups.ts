// Grouping for point layers (traffic cameras, webcams, ALPR cameras):
// zoomed out, points close together merge into one badge with their
// count, on a grid whose cell grows with the camera's height; clicking a
// badge zooms to its points (pick id "group:<prefix><w>,<s>,<e>,<n>",
// handled by zoomToGroup in Globe's click).

import { Cartesian3, NearFarScalar, Rectangle } from '@cesium/core';
import type { Billboard, Camera, Scene } from '@cesium/engine';

const DEG = Math.PI / 180;

// A count badge: a ring in the layer's colour with the number inside.
const badges = new Map<string, HTMLCanvasElement>();
function badge(count: number, color: string): HTMLCanvasElement {
  const label = count > 999 ? Math.floor(count / 1000) + 'k' : String(count);
  const key = color + label;
  const hit = badges.get(key);
  if (hit) return hit;
  const px = label.length > 2 ? 52 : 44;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (ctx) {
    const m = px / 2;
    ctx.beginPath();
    ctx.arc(m, m, m - 3, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(11, 14, 19, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, m, m + 1);
  }
  badges.set(key, c);
  return c;
}

// Grid cell (degrees of latitude) for a camera this high: about an
// eighth of the height (a badge's width or more on screen), in powers
// of two so it changes in steps.
// Below GROUP_BELOW_M every camera stands alone.
const GROUP_BELOW_M = 12_000;
const GROUP_MIN = 3;
export function cellFor(scene: Scene): number {
  const height = scene.camera.positionCartographic.height;
  if (height < GROUP_BELOW_M) return 0;
  return 2 ** Math.round(Math.log2(height / 8 / 111_000));
}

export const GROUP_PREFIX = 'group:';

// A group's pick id to the camera flight that shows its cameras; false
// when the id isn't a group's.
export function zoomToGroup(camera: Camera, id: string): boolean {
  if (!id.startsWith(GROUP_PREFIX)) return false;
  const box = id
    .slice(id.lastIndexOf(':') + 1)
    .split(',')
    .map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return false;
  const [w, s, e, n] = box;
  const padLat = Math.max((n - s) * 0.25, 0.004);
  const padLon = Math.max((e - w) * 0.25, 0.004);
  camera.flyTo({
    destination: Rectangle.fromDegrees(w - padLon, s - padLat, e + padLon, n + padLat),
    duration: 1.2,
  });
  return true;
}

type Point = { id: string; lat: number; lon: number };

// Points alone, and groups of GROUP_MIN or more sharing a cell (none
// when cell is 0). The selected point always stands alone.
export function groupByCell<T extends Point>(
  points: T[],
  cell: number,
  selected: string | null = null,
): { alone: T[]; groups: T[][] } {
  if (!cell) return { alone: points, groups: [] };
  const cells = new Map<string, T[]>();
  const alone: T[] = [];
  for (const p of points) {
    if (p.id === selected) {
      alone.push(p);
      continue;
    }
    const row = Math.floor(p.lat / cell);
    // Cells keep roughly square on the ground away from the equator.
    const lonCell = cell / Math.max(0.2, Math.cos((row + 0.5) * cell * DEG));
    const key = row + '/' + Math.floor(p.lon / lonCell);
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  const groups: T[][] = [];
  for (const list of cells.values()) {
    if (list.length >= GROUP_MIN) groups.push(list);
    else alone.push(...list);
  }
  return { alone, groups };
}

const groupScale = new NearFarScalar(5e4, 1, 3e6, 0.75);

// A group's badge, at the middle of its points.
export function groupBillboard(
  list: Point[],
  prefix: string,
  color: string,
  depth: number,
): Billboard.ConstructorOptions {
  let w = 180,
    s = 90,
    e = -180,
    n = -90,
    lat = 0,
    lon = 0;
  for (const p of list) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    lat += p.lat;
    lon += p.lon;
  }
  return {
    id: GROUP_PREFIX + prefix + [w, s, e, n].map((x) => x.toFixed(5)).join(','),
    position: Cartesian3.fromDegrees(lon / list.length, lat / list.length, 60),
    image: badge(list.length, color),
    scaleByDistance: groupScale,
    disableDepthTestDistance: depth,
  };
}

// Calls back with the new cell when a camera move crosses a grid step;
// returns the unsubscribe.
export function onCellChange(scene: Scene, changed: (cell: number) => void): () => void {
  let cell = cellFor(scene);
  return scene.camera.moveEnd.addEventListener(() => {
    const next = cellFor(scene);
    if (next === cell) return;
    cell = next;
    changed(next);
  });
}
