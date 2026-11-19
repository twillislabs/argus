// Camera views that ride along with the selected aircraft.
//
//   follow   top-down, centred on the aircraft; zoom and tilt still work
//   chase    behind and a little above, turning with the aircraft's track
//   orbit    circles the aircraft slowly; zoom still works
//   cockpit  from the aircraft, looking along its track
//
// Every frame the target is dead-reckoned from the last report, so the
// camera glides between the 10-15 s position updates. The offset from the
// target is kept in the aircraft's local east-north-up frame, which is what
// lets the mouse keep zooming and tilting in follow and orbit.

import {
  Cartesian3,
  FixedFrameTransforms,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
} from '@cesium/core';
import { type CesiumWidget, SceneMode } from '@cesium/engine';

import type { Aircraft } from '../lib/api';
import { type AircraftLayer, extrapolate } from './aircraftLayer';

export type CameraMode = 'free' | 'follow' | 'chase' | 'orbit' | 'cockpit';

export const CAMERA_MODES: { id: CameraMode; label: string; hint: string }[] = [
  { id: 'free', label: 'Free', hint: 'Move the map yourself' },
  { id: 'follow', label: 'Follow', hint: 'Top-down, centred on the aircraft' },
  { id: 'chase', label: 'Chase', hint: 'Behind the aircraft, turning with it' },
  { id: 'orbit', label: 'Orbit', hint: 'Circle the aircraft' },
  { id: 'cockpit', label: 'Cockpit', hint: 'From the aircraft, looking ahead' },
];

const ORBIT_PERIOD_S = 90;
const CHASE_PITCH = -0.22;
const ORBIT_PITCH = -0.5;
export const COCKPIT_PITCH = -0.06;

export interface AircraftCamera {
  setMode: (mode: CameraMode) => void;
  setTarget: (a: Aircraft | null) => void;
  tick: () => void;
  release: () => void;
}

export function createAircraftCamera(
  v: CesiumWidget,
  layer: () => AircraftLayer | null,
  // Each frame: where the target is now (dead-reckoned) and the view.
  onFrame?: (target: Aircraft, position: Cartesian3, mode: CameraMode) => void,
): AircraftCamera {
  let mode: CameraMode = 'free';
  let target: Aircraft | null = null;
  // When the target's report was made, in performance.now() seconds, and
  // in unix seconds (to tell newer reports from older copies).
  let reportedAt = 0;
  let reportUnix = 0;
  // A correction being eased out after a new report: the gap between where
  // the aircraft was drawn and where the new report puts it.
  let corr = { lat: 0, lon: 0, alt: 0, start: 0 };
  const EASE_S = 1.5;
  const SNAP_DEG = 0.05; // ~5 km: further than this, just jump

  function drawn(now: number) {
    if (!target) return null;
    const p = extrapolate(target, now - reportedAt);
    const k = corr.start ? Math.min(1, (now - corr.start) / EASE_S) : 1;
    const f = 1 - k;
    return { lon: p.lon + corr.lon * f, lat: p.lat + corr.lat * f, altM: p.altM + corr.alt * f };
  }
  let fresh = false;
  let lastTick = 0;

  const enu = new Matrix4();
  const offset = new Cartesian3();

  function release() {
    if (!Matrix4.equals(v.camera.transform, Matrix4.IDENTITY)) {
      v.camera.lookAtTransform(Matrix4.IDENTITY);
    }
    layer()?.setHidden(null);
  }

  return {
    setMode(next) {
      if (next === mode) return;
      mode = next;
      fresh = true;
      if (mode === 'free') release();
      layer()?.setHidden(mode === 'cockpit' && target ? target.hex : null);
    },
    setTarget(a) {
      const now = performance.now() / 1000;
      const same = Boolean(a && target && a.hex === target.hex);
      const unix = a ? (a.seen_at ?? Date.now() / 1000 - Math.max(0, a.seen ?? 0)) : 0;
      // The same aircraft from another feed or a cached answer: an older
      // (or the same) report must never pull it back along its track.
      if (a && same && unix <= reportUnix + 0.05) return;
      if (a && !same) fresh = true;
      const before = same ? drawn(now) : null;
      target = a;
      if (a) {
        reportUnix = unix;
        reportedAt = now - Math.max(0, Date.now() / 1000 - unix);
        // Ease from where it was drawn to where the new report puts it.
        const after = extrapolate(a, now - reportedAt);
        if (before && Math.abs(before.lat - after.lat) + Math.abs(before.lon - after.lon) < SNAP_DEG) {
          corr = { lat: before.lat - after.lat, lon: before.lon - after.lon, alt: before.altM - after.altM, start: now };
        } else {
          corr = { lat: 0, lon: 0, alt: 0, start: 0 };
        }
      }
      if (!a) release();
      else layer()?.setHidden(mode === 'cockpit' ? a.hex : null);
    },
    release,
    tick() {
      const now = performance.now() / 1000;
      const frame = lastTick ? Math.min(0.25, now - lastTick) : 0;
      lastTick = now;
      if (!target) return;
      const p = drawn(now);
      if (!p) return;
      const position = Cartesian3.fromDegrees(p.lon, p.lat, p.altM);
      layer()?.moveTo(target.hex, position);
      onFrame?.(target, position, mode);
      if (mode === 'free') return;

      const camera = v.camera;
      const track = CesiumMath.toRadians(target.track ?? 0);
      if (v.scene.mode !== SceneMode.SCENE3D) {
        // 2D and morphing: just keep the aircraft centred.
        if (v.scene.mode === SceneMode.SCENE2D) {
          camera.setView({
            destination: Cartesian3.fromDegrees(p.lon, p.lat, camera.positionCartographic.height),
          });
        }
        return;
      }

      if (mode === 'cockpit') {
        if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) camera.lookAtTransform(Matrix4.IDENTITY);
        camera.setView({
          destination: Cartesian3.fromDegrees(p.lon, p.lat, p.altM + 15),
          orientation: { heading: track, pitch: COCKPIT_PITCH, roll: 0 },
        });
        fresh = false;
        return;
      }

      FixedFrameTransforms.eastNorthUpToFixedFrame(position, undefined, enu);
      const inFrame = !Matrix4.equals(camera.transform, Matrix4.IDENTITY);
      const range = inFrame
        ? Cartesian3.magnitude(camera.position)
        : Math.min(Math.max(camera.positionCartographic.height - p.altM, 3_000), 400_000);

      if (fresh || !inFrame) {
        fresh = false;
        const start =
          mode === 'follow'
            ? new HeadingPitchRange(0, -CesiumMath.PI_OVER_TWO + 0.01, Math.min(range, 80_000))
            : mode === 'chase'
              ? new HeadingPitchRange(track, CHASE_PITCH, 2_500)
              : new HeadingPitchRange(track + Math.PI / 4, ORBIT_PITCH, 12_000);
        camera.lookAtTransform(enu, start);
        return;
      }

      if (mode === 'chase') {
        camera.lookAtTransform(enu, new HeadingPitchRange(track, CHASE_PITCH, range));
        return;
      }
      // Follow and orbit: keep the current offset (so zoom and tilt stick),
      // re-anchored on the moved aircraft; orbit also turns it slowly.
      Cartesian3.clone(camera.position, offset);
      if (mode === 'orbit') {
        const angle = (2 * Math.PI * frame) / ORBIT_PERIOD_S;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const x = offset.x * c - offset.y * s;
        offset.y = offset.x * s + offset.y * c;
        offset.x = x;
      }
      camera.lookAtTransform(enu, offset);
    },
  };
}
