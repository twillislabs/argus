// 3D models for the selected aircraft or vessel when the camera is close
// (chase, orbit, or zoomed in on follow). Far away, the flat glyphs are
// clearer, so the models only take over inside a few kilometres.
//
// The models come from backend/scripts/build_models.py: white, low-poly,
// nose along glTF +Z, tinted here to the target's colour.

import {
  Cartesian3,
  Color,
  FixedFrameTransforms,
  HeadingPitchRoll,
  Math as CesiumMath,
} from '@cesium/core';
import { ColorBlendMode, Model, type Scene } from '@cesium/engine';

export type ModelKind = 'aircraft' | 'ship';

// Camera distance below which the model replaces the glyph.
const RANGE_M: Record<ModelKind, number> = { aircraft: 12_000, ship: 8_000 };

export interface CloseModels {
  // Show the model at a position, or return false if the camera is too
  // far (the caller then keeps the glyph).
  place: (kind: ModelKind, position: Cartesian3, trackDeg: number, css: string) => boolean;
  hide: () => void;
  destroy: () => void;
}

export function addCloseModels(scene: Scene): CloseModels {
  const models: Partial<Record<ModelKind, Model>> = {};
  let destroyed = false;
  for (const kind of ['aircraft', 'ship'] as ModelKind[]) {
    void Model.fromGltfAsync({
      url: '/models/' + kind + '.glb',
      minimumPixelSize: kind === 'aircraft' ? 56 : 48,
      maximumScale: 20_000,
      color: Color.WHITE,
      colorBlendMode: ColorBlendMode.MIX,
      colorBlendAmount: 0.55,
      show: false,
    }).then((m) => {
      if (destroyed || scene.isDestroyed()) {
        m.destroy();
        return;
      }
      models[kind] = m;
      scene.primitives.add(m);
    });
  }
  const hpr = new HeadingPitchRoll();
  function hide() {
    for (const m of Object.values(models)) if (m) m.show = false;
  }
  return {
    place(kind, position, trackDeg, css) {
      const m = models[kind];
      const distance = Cartesian3.distance(scene.camera.positionWC, position);
      if (!m || distance > RANGE_M[kind]) {
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
