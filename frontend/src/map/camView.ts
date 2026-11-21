// The selected traffic camera's picture in the scene. Where the agency
// gives the way it faces: a view cone from the camera with the latest
// still on a panel at its far end, upright and square to the view (seen
// properly from behind the camera: GlobeHandle.lookAlong). Otherwise
// the still floats above the camera as a billboard. The image is our
// proxy's (/api/cams/{id}/image) and refreshes with the inspector.

import { Cartesian2, Cartesian3, Color, GeometryInstance, NearFarScalar, WallGeometry } from '@cesium/core';
import {
  BillboardCollection,
  Material,
  MaterialAppearance,
  PolylineCollection,
  Primitive,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { TrafficCam } from '../lib/api';
import { CAM_COLOR, VIEW_RANGE_M } from './camLayer';

// The view: 60 degrees wide (as camLayer's viewshed), the panel at its
// far end, 16:9.
const FOV = 60;
const MOUNT_M = 12;
const DEG = Math.PI / 180;
const EARTH_M = 6_371_000;
const REFRESH_MIN_S = 30;

function offset(lat: number, lon: number, bearing: number, metres: number): [number, number] {
  const b = bearing * DEG;
  return [
    lat + (metres * Math.cos(b)) / EARTH_M / DEG,
    lon + (metres * Math.sin(b)) / (EARTH_M * Math.cos(lat * DEG)) / DEG,
  ];
}

export interface CamView {
  show: (cam: TrafficCam | null) => void;
  destroy: () => void;
}

export function addCamView(scene: Scene): CamView {
  const lines = new PolylineCollection();
  const boards = new BillboardCollection({ scene });
  scene.primitives.add(lines);
  scene.primitives.add(boards);
  let panel: Primitive | null = null;
  let material: Material | null = null;
  let current: string | null = null;
  let timer = 0;
  const color = Color.fromCssColorString(CAM_COLOR);

  const clear = () => {
    window.clearInterval(timer);
    lines.removeAll();
    boards.removeAll();
    if (panel && !scene.isDestroyed() && scene.primitives.contains(panel)) scene.primitives.remove(panel);
    panel = null;
    material = null;
  };

  const url = (cam: TrafficCam) => cam.image + '?t=' + Math.floor(Date.now() / 1000);

  return {
    show(cam) {
      const key = cam ? cam.id + '@' + cam.direction : null;
      if (key === current) return;
      current = key;
      clear();
      if (!cam) {
        scene.requestRender();
        return;
      }
      if (cam.direction === null) {
        boards.add({
          position: Cartesian3.fromDegrees(cam.lon, cam.lat, 60),
          image: url(cam),
          width: 256,
          height: 144,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -18),
          scaleByDistance: new NearFarScalar(5e2, 1, 6e4, 0.45),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      } else {
        const half = VIEW_RANGE_M * Math.tan((FOV / 2) * DEG);
        const top = MOUNT_M + (half * 2 * 9) / 16;
        const [cLat, cLon] = offset(cam.lat, cam.lon, cam.direction, VIEW_RANGE_M);
        // Left and right as the camera sees them.
        const [lLat, lLon] = offset(cLat, cLon, cam.direction - 90, half);
        const [rLat, rLon] = offset(cLat, cLon, cam.direction + 90, half);
        material = Material.fromType('Image', { image: url(cam) });
        panel = new Primitive({
          geometryInstances: new GeometryInstance({
            geometry: new WallGeometry({
              positions: Cartesian3.fromDegreesArray([lLon, lLat, rLon, rLat]),
              maximumHeights: [top, top],
              minimumHeights: [MOUNT_M, MOUNT_M],
              vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
            }),
          }),
          appearance: new MaterialAppearance({
            material,
            materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
            faceForward: true,
            translucent: false,
          }),
          asynchronous: false,
        });
        scene.primitives.add(panel);
        const apex = Cartesian3.fromDegrees(cam.lon, cam.lat, MOUNT_M);
        const corners = [
          Cartesian3.fromDegrees(lLon, lLat, top),
          Cartesian3.fromDegrees(rLon, rLat, top),
          Cartesian3.fromDegrees(rLon, rLat, MOUNT_M),
          Cartesian3.fromDegrees(lLon, lLat, MOUNT_M),
        ];
        for (const c of corners) lines.add({ positions: [apex, c], width: 1.5, material: lineMaterial(color, 0.75) });
        lines.add({
          positions: [...corners, corners[0]],
          width: 2,
          material: lineMaterial(color, 1),
        });
      }
      const every = Math.max(REFRESH_MIN_S, cam.refresh_s || REFRESH_MIN_S) * 1000;
      timer = window.setInterval(() => {
        if (document.hidden) return;
        if (material) material.uniforms.image = url(cam);
        else if (boards.length) boards.get(0).image = url(cam);
        scene.requestRender();
      }, every);
      scene.requestRender();
    },
    destroy() {
      clear();
      if (scene.isDestroyed()) return;
      if (scene.primitives.contains(lines)) scene.primitives.remove(lines);
      if (scene.primitives.contains(boards)) scene.primitives.remove(boards);
    },
  };
}

function lineMaterial(color: Color, alpha: number): Material {
  return Material.fromType('Color', { color: color.withAlpha(alpha) });
}
