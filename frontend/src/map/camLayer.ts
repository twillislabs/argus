// Traffic cameras (agency CCTV): a small camera glyph, with a wedge for
// the direction it looks where the agency says. Pickable as "cam:<id>".
// Zoomed in, those cameras also get their estimated viewshed on the
// ground: a VIEW_FOV sector VIEW_RANGE_M deep (agencies don't publish
// zoom or tilt, so it's indicative), brighter for the selected camera.
// Zoomed out, cameras close together merge into one badge with their
// count (a grid cell that grows with the camera's height); clicking it
// zooms to them ("group:<prefix><w>,<s>,<e>,<n>", see zoomToGroup).

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  NearFarScalar,
  PolygonGeometry,
  PolygonHierarchy,
  Rectangle,
} from '@cesium/core';
import { BillboardCollection, type Camera, PerInstanceColorAppearance, Primitive, type Scene } from '@cesium/engine';

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
function cellFor(height: number): number {
  if (height < GROUP_BELOW_M) return 0;
  return 2 ** Math.round(Math.log2(height / 8 / 111_000));
}

// The view's height above the ground (in 2D, the zoom's equivalent).
function heightOf(scene: Scene): number {
  return scene.camera.positionCartographic.height;
}

const GROUP_PREFIX = 'group:';

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

const VIEW_FOV = 60;
const VIEW_RANGE_M = 300;
const EARTH_M = 6_371_000;

// The sector's outline: the camera, then an arc VIEW_RANGE_M out.
function sector(lat: number, lon: number, bearing: number): Cartesian3[] {
  const pts = [Cartesian3.fromDegrees(lon, lat, 4)];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const b = (bearing - VIEW_FOV / 2 + (VIEW_FOV * i) / steps) * DEG;
    const dLat = (VIEW_RANGE_M * Math.cos(b)) / EARTH_M / DEG;
    const dLon = (VIEW_RANGE_M * Math.sin(b)) / (EARTH_M * Math.cos(lat * DEG)) / DEG;
    pts.push(Cartesian3.fromDegrees(lon + dLon, lat + dLat, 4));
  }
  return pts;
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
  const groupScale = new NearFarScalar(5e4, 1, 3e6, 0.75);
  let depth = 0;
  let views: Primitive | null = null;
  // What the views were built for: rebuilding on every call would
  // replace them before they finish building (they build in a worker).
  let viewsKey = '';
  const base = Color.fromCssColorString(color);
  // The last update, redrawn when the zoom crosses a grid step.
  let shown: Placed[] = [];
  let isVisible = false;
  let picked: string | null = null;
  let cell = cellFor(heightOf(scene));
  const dropViews = () => {
    if (views && !scene.isDestroyed() && scene.primitives.contains(views)) scene.primitives.remove(views);
    views = null;
  };

  // Cameras alone, and groups of GROUP_MIN or more sharing a cell. The
  // selected camera always stands alone.
  const group = (cams: Placed[]) => {
    if (!cell) return { alone: cams, groups: [] as Placed[][] };
    const cells = new Map<string, Placed[]>();
    const alone: Placed[] = [];
    for (const c of cams) {
      if (c.id === picked) {
        alone.push(c);
        continue;
      }
      const row = Math.floor(c.lat / cell);
      // Cells keep roughly square on the ground away from the equator.
      const lonCell = cell / Math.max(0.2, Math.cos((row + 0.5) * cell * DEG));
      const key = row + '/' + Math.floor(c.lon / lonCell);
      const list = cells.get(key);
      if (list) list.push(c);
      else cells.set(key, [c]);
    }
    const groups: Placed[][] = [];
    for (const list of cells.values()) {
      if (list.length >= GROUP_MIN) groups.push(list);
      else alone.push(...list);
    }
    return { alone, groups };
  };

  const draw = () => {
    billboards.removeAll();
    const { alone, groups } = isVisible ? group(shown) : { alone: [], groups: [] };
    const key = isVisible
      ? picked + '|' + alone.map((c) => (c.direction != null ? c.id + '@' + c.direction : '')).join(',')
      : '';
    if (key !== viewsKey) {
      dropViews();
      viewsKey = key;
    }
    if (!isVisible) return;
    const instances = views
      ? []
      : alone
          .filter((c) => c.direction !== null && c.direction !== undefined)
          .map(
            (c) =>
              new GeometryInstance({
                geometry: new PolygonGeometry({
                  polygonHierarchy: new PolygonHierarchy(sector(c.lat, c.lon, c.direction ?? 0)),
                  height: 4,
                  vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                  color: ColorGeometryInstanceAttribute.fromColor(base.withAlpha(c.id === picked ? 0.45 : 0.16)),
                },
              }),
          );
    if (instances.length && !views) {
      views = new Primitive({
        geometryInstances: instances,
        // No depth test: the dark map's land shapes sit 300 m up
        // and would hide a sector on the ground.
        appearance: new PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          renderState: { depthTest: { enabled: false } },
        }),
        asynchronous: true,
      });
      scene.primitives.add(views);
    }
    for (const c of alone) {
      const facing = c.direction !== null && c.direction !== undefined;
      billboards.add({
        id: prefix + c.id,
        position: Cartesian3.fromDegrees(c.lon, c.lat, 40),
        image: facing ? withWedge : plain,
        rotation: facing ? -(c.direction ?? 0) * DEG : 0,
        alignedAxis: Cartesian3.UNIT_Z,
        scale: c.id === picked ? 1.4 : 1,
        scaleByDistance: scale,
        disableDepthTestDistance: depth,
      });
    }
    for (const list of groups) {
      let w = 180,
        s = 90,
        e = -180,
        n = -90,
        lat = 0,
        lon = 0;
      for (const c of list) {
        w = Math.min(w, c.lon);
        e = Math.max(e, c.lon);
        s = Math.min(s, c.lat);
        n = Math.max(n, c.lat);
        lat += c.lat;
        lon += c.lon;
      }
      billboards.add({
        id: GROUP_PREFIX + prefix + [w, s, e, n].map((x) => x.toFixed(5)).join(','),
        position: Cartesian3.fromDegrees(lon / list.length, lat / list.length, 60),
        image: badge(list.length, color),
        scaleByDistance: groupScale,
        disableDepthTestDistance: depth,
      });
    }
    scene.requestRender();
  };

  const onMoved = () => {
    const next = cellFor(heightOf(scene));
    if (next === cell) return;
    cell = next;
    if (isVisible) draw();
  };
  const stopListening = scene.camera.moveEnd.addEventListener(onMoved);

  return {
    update(cams, visible, selected) {
      shown = cams;
      isVisible = visible;
      picked = selected;
      cell = cellFor(heightOf(scene));
      draw();
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < billboards.length; i++) billboards.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      stopListening();
      dropViews();
      if (!scene.isDestroyed() && scene.primitives.contains(billboards)) scene.primitives.remove(billboards);
    },
  };
}
