// How often the globe redraws. Cesium's default redraws every display
// frame (60 to 144 a second) even when nothing on the map moves, which
// keeps the GPU busy and the computer warm. Here Cesium renders on
// demand: at the full rate while you interact, the camera moves (Cesium
// renders camera changes and tile loads by itself) or a view follows an
// aircraft, and otherwise only a few times a second, enough for
// aircraft, satellites and new data to keep moving.

import { Matrix4 } from '@cesium/core';
import type { CesiumWidget } from '@cesium/engine';

import type { RenderMode } from '../lib/api';

// Milliseconds between frames when nothing is happening.
const IDLE_MS: Record<RenderMode, number> = { smooth: 0, balanced: 100, saver: 500 };
// Anti-aliasing samples in 3D (2D always uses 1).
const MSAA: Record<RenderMode, number> = { smooth: 4, balanced: 2, saver: 1 };
// After the last input, keep the full rate this long (inertia, menus).
const AWAKE_MS = 1500;
const INPUTS = ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove', 'keydown'] as const;

export interface RenderGovernor {
  setMode: (mode: RenderMode) => void;
  // The anti-aliasing samples for 3D in this mode.
  msaa: () => number;
  // Full rate for a while: something on the map started moving.
  wake: (ms?: number) => void;
  destroy: () => void;
}

// still: the camera is held on something that doesn't move (a rocket on
// its pad), so a held camera needn't redraw every frame.
export function governRendering(
  v: CesiumWidget,
  mode: RenderMode,
  onMode?: () => void,
  still?: () => boolean,
): RenderGovernor {
  const scene = v.scene;
  scene.requestRenderMode = true;
  scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  let current = mode;
  let awakeUntil = 0;
  let last = 0;
  let raf = 0;
  let stopped = false;

  const wake = (ms = AWAKE_MS) => {
    awakeUntil = Math.max(awakeUntil, performance.now() + ms);
    scene.requestRender();
  };
  const onInput = () => wake();
  for (const e of INPUTS) scene.canvas.addEventListener(e, onInput, { passive: true });
  window.addEventListener('keydown', onInput, { passive: true });

  const loop = (t: number) => {
    if (stopped) return;
    raf = window.requestAnimationFrame(loop);
    if (document.hidden || scene.isDestroyed()) return;
    // A camera riding along with an aircraft moves every frame.
    const riding = !Matrix4.equals(v.camera.transform, Matrix4.IDENTITY) && !still?.();
    if (t < awakeUntil || riding || t - last >= IDLE_MS[current]) {
      last = t;
      scene.requestRender();
    }
  };
  raf = window.requestAnimationFrame(loop);

  return {
    setMode(m) {
      if (m === current) return;
      current = m;
      onMode?.();
      wake(300);
    },
    msaa: () => MSAA[current],
    wake,
    destroy() {
      stopped = true;
      window.cancelAnimationFrame(raf);
      for (const e of INPUTS) scene.canvas.removeEventListener(e, onInput);
      window.removeEventListener('keydown', onInput);
    },
  };
}
