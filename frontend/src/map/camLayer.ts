// Traffic cameras (agency CCTV): a small camera glyph, with a wedge for
// the direction it looks where the agency says. Pickable as "cam:<id>".
// Zoomed in, those cameras also get their estimated viewshed on the
// ground: a VIEW_FOV sector VIEW_RANGE_M deep (agencies don't publish
// zoom or tilt, so it's indicative), brighter for the selected camera.
// Zoomed out, cameras close together merge into one badge with their
// count (map/groups.ts).

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  NearFarScalar,
  PolygonGeometry,
  PolygonHierarchy,
} from '@cesium/core';
import { BillboardCollection, PerInstanceColorAppearance, Primitive, type Scene } from '@cesium/engine';

import type { TrafficCam } from '../lib/api';
import { cellFor, groupBillboard, groupByCell, onCellChange } from './groups';

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

// The camera you're looking at: a bright ring around its marker, so it
// stands out among its neighbours.
function ring(color: string): HTMLCanvasElement {
  const px = 64;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const m = px / 2;
  ctx.beginPath();
  ctx.arc(m, m, m - 5, 0, 2 * Math.PI);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(m, m, m - 11, 0, 2 * Math.PI);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.stroke();
  return c;
}

const VIEW_FOV = 60;
export const VIEW_RANGE_M = 300;
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
  const halo = ring(color);
  const scale = new NearFarScalar(2e3, 0.9, 2e5, 0.4);
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
  let cell = cellFor(scene);
  const dropViews = () => {
    if (views && !scene.isDestroyed() && scene.primitives.contains(views)) scene.primitives.remove(views);
    views = null;
  };

  const draw = () => {
    billboards.removeAll();
    const { alone, groups } = isVisible ? groupByCell(shown, cell, picked) : { alone: [], groups: [] };
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
      if (c.id === picked) {
        billboards.add({
          id: prefix + c.id,
          position: Cartesian3.fromDegrees(c.lon, c.lat, 40),
          image: halo,
          scale: 1.1,
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
        });
      }
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
    for (const list of groups) billboards.add(groupBillboard(list, prefix, color, depth));
    scene.requestRender();
  };

  const stopListening = onCellChange(scene, (next) => {
    cell = next;
    if (isVisible) draw();
  });

  return {
    update(cams, visible, selected) {
      shown = cams;
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
      dropViews();
      if (!scene.isDestroyed() && scene.primitives.contains(billboards)) scene.primitives.remove(billboards);
    },
  };
}
