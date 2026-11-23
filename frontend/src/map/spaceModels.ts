// 3D models of crewed stations and the vehicles around them: the ISS and
// Tiangong, Crew Dragon, Soyuz and Progress, Shenzhou, cargo ships
// (Tianzhou, Cygnus) and spent rocket stages. The shapes come from
// backend/scripts/build_models.py.
//
// A vehicle within DOCK_M of a station is drawn at one of that station's
// docking ports (its catalogue position is the station's, give or take
// the elements' error), so a docked Dragon sits on Harmony's forward port
// instead of inside the truss. Which port each one really uses isn't in
// the catalogue: they fill the ports in NORAD order, US vehicles on the
// US side and Soyuz and Progress on the Russian side.
//
// Stations are scaled up together with their docked vehicles, so the
// group stays readable from far away and keeps its true size up close
// (Cesium's own minimumPixelSize would scale each model separately).

import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  FixedFrameTransforms,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
} from '@cesium/core';
import { ColorBlendMode, Model, type Scene } from '@cesium/engine';

export const ISS_NORAD = 25544;

export type SpaceModelKind = 'iss' | 'tiangong' | 'dragon' | 'soyuz' | 'shenzhou' | 'cargo' | 'stage';
// A station's own modules catalogued separately (ISS (NAUKA), POISK,
// CSS (WENTIAN) ...): part of the station's model, no model of their own.
export type SpaceRole = SpaceModelKind | 'part:iss' | 'part:tiangong';

const STATIONS = new Set<SpaceModelKind>(['iss', 'tiangong']);

export function spaceRole(norad: number, name: string): SpaceRole | null {
  const n = name.toUpperCase();
  if (norad === ISS_NORAD) return 'iss';
  if (n.startsWith('CSS (TIANHE')) return 'tiangong';
  if (n.startsWith('ISS (') || n.startsWith('POISK')) return 'part:iss';
  if (n.startsWith('CSS (')) return 'part:tiangong';
  if (n.includes('DRAGON')) return 'dragon';
  if (/^(SOYUZ|PROGRESS)/.test(n)) return 'soyuz';
  if (n.startsWith('SHENZHOU')) return 'shenzhou';
  if (/^(TIANZHOU|CYGNUS|HTV)/.test(n)) return 'cargo';
  if (/\bR\/B\b/.test(n)) return 'stage';
  return null;
}

// Roughly half the model's longest extent (metres): how close the
// camera may come, and how far out a follow starts.
export const MODEL_RADIUS: Record<SpaceModelKind, number> = {
  iss: 55,
  tiangong: 30,
  dragon: 4.5,
  soyuz: 4,
  shenzhou: 5,
  cargo: 5.5,
  stage: 7,
};

// How large a station (with what's docked) is drawn at the least, and a
// free-flying vehicle, in pixels.
const STATION_MIN_PX = 44;
const VEHICLE_MIN_PX = 22;
const DOCK_M = 5000;

interface Port {
  // Where, and which way it faces, in the station model's glTF axes
  // (+Z the direction of flight, +Y away from Earth).
  at: [number, number, number];
  facing: [number, number, number];
  takes: SpaceModelKind[];
}

// From build_models.py's iss() and tiangong() docstrings.
const PORTS: Partial<Record<SpaceModelKind, Port[]>> = {
  iss: [
    { at: [0, 0, 18], facing: [0, 0, 1], takes: ['dragon', 'cargo'] },
    { at: [0, 4.3, 11], facing: [0, 1, 0], takes: ['dragon', 'cargo'] },
    { at: [0, 0, -34], facing: [0, 0, -1], takes: ['soyuz'] },
    { at: [0, 6.1, -20], facing: [0, 1, 0], takes: ['soyuz'] },
    { at: [0, -8.1, -12], facing: [0, -1, 0], takes: ['soyuz'] },
    { at: [0, -18, -27], facing: [0, -1, 0], takes: ['soyuz'] },
  ],
  tiangong: [
    { at: [0, 0, 8.2], facing: [0, 0, 1], takes: ['shenzhou'] },
    { at: [0, -2.2, 6], facing: [0, -1, 0], takes: ['shenzhou'] },
    { at: [0, 0, -10.5], facing: [0, 0, -1], takes: ['cargo'] },
  ],
};

// Cesium turns glTF's axes into the model's local frame: glTF +Z (nose)
// to local +X, +Y (up) to +Z, +X to +Y (see closeModels.ts: +Z faces
// east at heading 0).
const GLTF_TO_LOCAL = Matrix4.fromRotationTranslation(new Matrix3(0, 0, 1, 1, 0, 0, 0, 1, 0));
const LOCAL_TO_GLTF = Matrix4.inverseTransformation(GLTF_TO_LOCAL, new Matrix4());

// A docked vehicle's placement in the station's glTF axes: its docking
// ring (the origin of the vehicle's model) on the port, its nose (+Z)
// pointing into the station.
function portMatrix(port: Port): Matrix4 {
  const z = Cartesian3.negate(Cartesian3.fromArray(port.facing), new Cartesian3());
  // Axial ports keep the station's up; radial ones point the vehicle's
  // top along the station's direction of flight.
  const up = Math.abs(port.facing[2]) > 0.5 ? Cartesian3.UNIT_Y : Cartesian3.UNIT_Z;
  const x = Cartesian3.normalize(Cartesian3.cross(up, z, new Cartesian3()), new Cartesian3());
  const y = Cartesian3.cross(z, x, new Cartesian3());
  const r = new Matrix3();
  Matrix3.setColumn(r, 0, x, r);
  Matrix3.setColumn(r, 1, y, r);
  Matrix3.setColumn(r, 2, z, r);
  const inGltf = Matrix4.fromRotationTranslation(r, Cartesian3.fromArray(port.at));
  // Expressed in the local frame the station's modelMatrix applies to.
  return Matrix4.multiply(Matrix4.multiply(GLTF_TO_LOCAL, inGltf, new Matrix4()), LOCAL_TO_GLTF, new Matrix4());
}

const PORT_MATRICES = new Map<Port, Matrix4>();
for (const ports of Object.values(PORTS)) for (const p of ports ?? []) PORT_MATRICES.set(p, portMatrix(p));

export interface SpaceEntry {
  norad: number;
  role: SpaceRole;
  // Where it is now (smoothed) and its velocity, Earth-fixed.
  position: Cartesian3;
  velocity: Cartesian3;
}

export interface SpaceModels {
  // Each frame: place every model, returning where each object is drawn
  // (docked vehicles at their port, a station's modules at the station).
  // following: the satellite a follow camera is riding with, if any.
  frame: (entries: SpaceEntry[], following: number | null) => Map<number, Cartesian3>;
  // Which station a vehicle is docked to, from the last frame.
  dockedTo: (norad: number) => number | null;
  destroy: () => void;
}

export function createSpaceModels(scene: Scene): SpaceModels {
  const models = new Map<number, { kind: SpaceModelKind; model: Model | null }>();
  const docked = new Map<number, number>();
  let destroyed = false;

  function modelFor(norad: number, kind: SpaceModelKind): Model | null {
    const have = models.get(norad);
    if (have && have.kind === kind) return have.model;
    if (have?.model) scene.primitives.remove(have.model);
    const slot: { kind: SpaceModelKind; model: Model | null } = { kind, model: null };
    models.set(norad, slot);
    void Model.fromGltfAsync({
      url: '/models/' + kind + '.glb',
      // Picks select the satellite, like its point.
      id: 'sat:' + norad,
      color: Color.WHITE,
      colorBlendMode: ColorBlendMode.MIX,
      colorBlendAmount: 0,
      show: false,
    })
      .then((m) => {
        if (destroyed || scene.isDestroyed() || models.get(norad) !== slot) {
          m.destroy();
          return;
        }
        slot.model = m;
        scene.primitives.add(m);
      })
      .catch(() => undefined);
    return null;
  }

  const hpr = new HeadingPitchRoll();
  const enu = new Matrix4();
  const inv = new Matrix4();
  const local = new Cartesian3();
  const eye = new Cartesian3();
  const scratchPx = new Cartesian2();

  // Model matrix at a position, nose along the velocity, top away from
  // Earth, scaled by k.
  function place(position: Cartesian3, velocity: Cartesian3, k: number, result: Matrix4): Matrix4 {
    FixedFrameTransforms.eastNorthUpToFixedFrame(position, undefined, enu);
    Matrix4.inverseTransformation(enu, inv);
    Matrix4.multiplyByPointAsVector(inv, velocity, local);
    // glTF +Z faces east at heading 0 (as in closeModels.ts).
    hpr.heading = Math.atan2(local.x, local.y) - CesiumMath.PI_OVER_TWO;
    hpr.pitch = 0;
    hpr.roll = 0;
    FixedFrameTransforms.headingPitchRollToFixedFrame(position, hpr, undefined, undefined, result);
    if (k !== 1) Matrix4.multiplyByUniformScale(result, k, result);
    return result;
  }

  // Where the camera will be this frame. Models are placed before a
  // follow camera moves (it rides on their drawn position), so measuring
  // from the camera's last position would be a frame of orbital motion
  // out (kilometres at a low frame rate), and the scale with it.
  function eyeFor(entries: SpaceEntry[], following: number | null) {
    const camera = scene.camera;
    Cartesian3.clone(camera.positionWC, eye);
    if (following === null || Matrix4.equals(camera.transform, Matrix4.IDENTITY)) return;
    const target = entries.find((e) => e.norad === following);
    if (!target) return;
    const origin = Matrix4.getTranslation(camera.transform, local);
    Cartesian3.add(eye, Cartesian3.subtract(target.position, origin, local), eye);
  }

  // Scale that keeps a model of this radius at least minPx across.
  function minScale(position: Cartesian3, radius: number, minPx: number): number {
    const distance = Math.max(1, Cartesian3.distance(eye, position) - radius);
    const mpp = scene.camera.frustum.getPixelDimensions(
      scene.drawingBufferWidth,
      scene.drawingBufferHeight,
      distance,
      (scene as unknown as { pixelRatio?: number }).pixelRatio ?? 1,
      scratchPx,
    ).x;
    const px = (2 * radius) / Math.max(mpp, 1e-9);
    return px >= minPx ? 1 : minPx / px;
  }

  return {
    frame(entries, following) {
      eyeFor(entries, following);
      const drawn = new Map<number, Cartesian3>();
      const used = new Set<number>();
      docked.clear();
      // Stations first: the vehicles hang off them.
      const stations = new Map<SpaceModelKind, { norad: number; matrix: Matrix4; raw: Cartesian3 }>();
      for (const e of entries) {
        const kind = e.role as SpaceModelKind;
        if (!STATIONS.has(kind)) continue;
        const model = modelFor(e.norad, kind);
        used.add(e.norad);
        const k = minScale(e.position, MODEL_RADIUS[kind], STATION_MIN_PX);
        const matrix = place(e.position, e.velocity, k, new Matrix4());
        stations.set(kind, { norad: e.norad, matrix, raw: e.position });
        drawn.set(e.norad, e.position);
        if (model) {
          model.modelMatrix = matrix;
          model.show = true;
        }
      }
      const taken = new Set<Port>();
      const vehicles = entries.filter((e) => !STATIONS.has(e.role as SpaceModelKind)).sort((a, b) => a.norad - b.norad);
      for (const e of vehicles) {
        if (e.role === 'part:iss' || e.role === 'part:tiangong') {
          const s = stations.get(e.role === 'part:iss' ? 'iss' : 'tiangong');
          drawn.set(e.norad, s ? s.raw : e.position);
          continue;
        }
        const kind = e.role as SpaceModelKind;
        const model = modelFor(e.norad, kind);
        used.add(e.norad);
        let matrix: Matrix4 | null = null;
        for (const [skind, s] of stations) {
          if (Cartesian3.distance(s.raw, e.position) > DOCK_M) continue;
          const port = PORTS[skind]?.find((p) => !taken.has(p) && p.takes.includes(kind));
          if (!port) continue;
          taken.add(port);
          matrix = Matrix4.multiply(s.matrix, PORT_MATRICES.get(port)!, new Matrix4());
          docked.set(e.norad, s.norad);
          break;
        }
        if (!matrix) {
          const k = minScale(e.position, MODEL_RADIUS[kind], VEHICLE_MIN_PX);
          matrix = place(e.position, e.velocity, k, new Matrix4());
        }
        drawn.set(e.norad, Matrix4.getTranslation(matrix, new Cartesian3()));
        if (model) {
          model.modelMatrix = matrix;
          model.show = true;
        }
      }
      for (const [norad, slot] of models) {
        if (used.has(norad)) continue;
        if (slot.model) slot.model.show = false;
      }
      return drawn;
    },
    dockedTo(norad) {
      return docked.get(norad) ?? null;
    },
    destroy() {
      destroyed = true;
      if (scene.isDestroyed()) return;
      for (const { model } of models.values()) {
        if (model && scene.primitives.contains(model)) scene.primitives.remove(model);
      }
      models.clear();
    },
  };
}

// Within this distance the 3D model shows on its own: the point marker
// would sit on top of it.
export const MODEL_POINT_HIDE = new DistanceDisplayCondition(50_000, Number.MAX_VALUE);
