// 3D models for the selected aircraft or vessel when the camera is close
// (chase, orbit, or zoomed in on follow). Far away, the flat glyphs are
// clearer, so the models only take over inside a few kilometres.
//
// The models come from backend/scripts/build_models.py: white, low-poly,
// nose along glTF +Z, tinted here to the target's colour. One is picked
// per target (airliner, helicopter, tanker ...) and loaded on first use.

import { Cartesian3, Color, FixedFrameTransforms, HeadingPitchRoll, Math as CesiumMath } from '@cesium/core';
import { ColorBlendMode, Model, type Scene } from '@cesium/engine';

import type { Aircraft, Vessel } from '../lib/api';

export type AircraftModel = 'airliner' | 'widebody' | 'bizjet' | 'light' | 'helicopter' | 'fighter' | 'airlifter';
export type ShipModel = 'container' | 'tanker' | 'passenger' | 'fishing' | 'warship' | 'boat';
export type ModelKind = AircraftModel | ShipModel;

const SHIPS = new Set<ModelKind>(['container', 'tanker', 'passenger', 'fishing', 'warship', 'boat']);

// ICAO type designators of widebodies and light aircraft, for aircraft
// that don't report an emitter category.
const WIDEBODY =
  /^(B74|B76|B77|B78|A30|A31|A33|A34|A35|A38|MD11|DC10|IL96|K35|KC46|E3TF|E3CF|E6B|C5M|B52|A400|A124|AN12|AN2[2-5])/;
const LIGHT = /^(C1[5-9]\d|C2\d\d|PA\d|P28|SR2|BE[0-9]|DA4|M20|C42|DR40|AA5|PC12)/;

export function aircraftModel(a: Aircraft): AircraftModel {
  const type = (a.type || '').toUpperCase();
  if (a.role === 'Helicopter' || a.role === 'Tiltrotor' || a.category === 'A7') return 'helicopter';
  if (a.role === 'Fighter') return 'fighter';
  if (a.role === 'Airlift' && !WIDEBODY.test(type)) return 'airlifter';
  if (WIDEBODY.test(type) || a.category === 'A5' || a.role === 'Bomber') return 'widebody';
  if (a.category === 'A1' || LIGHT.test(type)) return 'light';
  if (a.category === 'A2') return 'bizjet';
  return 'airliner';
}

export function shipModel(v: Vessel | null | undefined): ShipModel {
  switch (v?.category) {
    case 'cargo':
      return 'container';
    case 'tanker':
      return 'tanker';
    case 'passenger':
      return (v.length ?? 0) && (v.length ?? 0) < 60 ? 'boat' : 'passenger';
    case 'fishing':
      return 'fishing';
    case 'military':
      return (v.length ?? 0) && (v.length ?? 0) < 40 ? 'boat' : 'warship';
    default:
      return 'boat';
  }
}

// Camera distance below which the model replaces the glyph.
const rangeM = (kind: ModelKind) => (SHIPS.has(kind) ? 8_000 : 12_000);

export interface CloseModels {
  // Show the model at a position, or return false if the camera is too
  // far (the caller then keeps the glyph).
  place: (kind: ModelKind, position: Cartesian3, trackDeg: number, css: string) => boolean;
  hide: () => void;
  destroy: () => void;
}

export function addCloseModels(scene: Scene): CloseModels {
  const models: Partial<Record<ModelKind, Model>> = {};
  const loading = new Set<ModelKind>();
  let destroyed = false;
  function load(kind: ModelKind) {
    if (models[kind] || loading.has(kind)) return;
    loading.add(kind);
    void Model.fromGltfAsync({
      url: '/models/' + kind + '.glb',
      minimumPixelSize: SHIPS.has(kind) ? 64 : 84,
      maximumScale: 20_000,
      color: Color.WHITE,
      colorBlendMode: ColorBlendMode.MIX,
      colorBlendAmount: 0.55,
      show: false,
    })
      .then((m) => {
        if (destroyed || scene.isDestroyed()) {
          m.destroy();
          return;
        }
        models[kind] = m;
        scene.primitives.add(m);
      })
      .catch(() => undefined)
      .finally(() => loading.delete(kind));
  }
  const hpr = new HeadingPitchRoll();
  function hide() {
    for (const m of Object.values(models)) if (m) m.show = false;
  }
  return {
    place(kind, position, trackDeg, css) {
      const distance = Cartesian3.distance(scene.camera.positionWC, position);
      if (distance <= rangeM(kind) * 2) load(kind);
      const m = models[kind];
      if (!m || distance > rangeM(kind)) {
        hide();
        return false;
      }
      for (const [k, other] of Object.entries(models)) if (other && k !== kind) other.show = false;
      // Cesium turns glTF +Z to face east at heading 0; compass tracks
      // count from north, so subtract 90 degrees.
      hpr.heading = CesiumMath.toRadians(trackDeg - 90);
      m.modelMatrix = FixedFrameTransforms.headingPitchRollToFixedFrame(position, hpr);
      m.color = Color.fromCssColorString(css);
      m.show = true;
      return true;
    },
    hide,
    destroy() {
      destroyed = true;
      for (const m of Object.values(models)) {
        if (m && !m.isDestroyed() && scene.primitives.contains(m)) scene.primitives.remove(m);
      }
    },
  };
}
