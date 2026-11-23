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
import { type AircraftLayer, extrapolateTurning } from './aircraftLayer';

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
  onFrame?: (target: Aircraft, position: Cartesian3, mode: CameraMode, headingDeg: number) => void,
): AircraftCamera {
  let mode: CameraMode = 'free';
  let target: Aircraft | null = null;
  // When the target's report was made, in performance.now() seconds, and
  // in unix seconds (to tell newer reports from older copies).
  let reportedAt = 0;
  let reportUnix = 0;
  // A correction being eased out after a new report: the gap between where
  // the aircraft was drawn and where the new report puts it.
  let corr = { lat: 0, lon: 0, alt: 0, hdg: 0, start: 0 };
  const EASE_S = 1.5;
  // Headings ease more slowly, so a new report's track doesn't swing the
  // cockpit view round in one go.
  const HEADING_EASE_S = 3;
  const SNAP_DEG = 0.05; // ~5 km: further than this, just jump
  // Turn rate from the last two reports (degrees a second), so the
  // aircraft is dead-reckoned round a turn instead of straight on.
  let turnRate = 0;
  const MAX_TURN = 3; // a standard-rate turn is 3 degrees a second

  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

  function drawn(now: number) {
    if (!target) return null;
    const p = extrapolateTurning(target, now - reportedAt, turnRate);
    const k = corr.start ? Math.min(1, (now - corr.start) / EASE_S) : 1;
    const kh = corr.start ? Math.min(1, (now - corr.start) / HEADING_EASE_S) : 1;
    const f = 1 - k;
    const fh = 1 - kh * kh * (3 - 2 * kh); // smoothstep
    return {
      lon: p.lon + corr.lon * f,
      lat: p.lat + corr.lat * f,
      altM: p.altM + corr.alt * f,
      track: (p.track + corr.hdg * fh + 360) % 360,
    };
  }
  let fresh = false;
  let lastTick = 0;

  const enu = new Matrix4();
  const offset = new Cartesian3();

  // Whether these views put the camera in a lookAt frame: only then
  // release it. Following a satellite or orbiting a rocket holds the
  // camera the same way, and a deselect here must not drop that.
  let holding = false;

  function release() {
    if (holding && !Matrix4.equals(v.camera.transform, Matrix4.IDENTITY)) {
      v.camera.lookAtTransform(Matrix4.IDENTITY);
    }
    holding = false;
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
      const prev = same ? target : null;
      const prevUnix = reportUnix;
      target = a;
      if (a) {
        // Turn rate from this report and the one before (same aircraft).
        const gap = unix - prevUnix;
        if (prev && prev.track !== null && a.track !== null && gap >= 2 && gap <= 60 && !a.ground) {
          const rate = wrap(a.track - prev.track) / gap;
          turnRate = Math.abs(rate) < 0.2 ? 0 : Math.max(-MAX_TURN, Math.min(MAX_TURN, rate));
        } else if (!same) {
          turnRate = 0;
        }
        reportUnix = unix;
        reportedAt = now - Math.max(0, Date.now() / 1000 - unix);
        // Ease from where it was drawn to where the new report puts it.
        const after = extrapolateTurning(a, now - reportedAt, turnRate);
        if (before && Math.abs(before.lat - after.lat) + Math.abs(before.lon - after.lon) < SNAP_DEG) {
          corr = {
            lat: before.lat - after.lat,
            lon: before.lon - after.lon,
            alt: before.altM - after.altM,
            hdg: wrap(before.track - after.track),
            start: now,
          };
        } else {
          corr = { lat: 0, lon: 0, alt: 0, hdg: 0, start: 0 };
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
      onFrame?.(target, position, mode, p.track);
      if (mode === 'free') return;

      const camera = v.camera;
      // The heading the aircraft is drawn with, eased and turning with it.
      const track = CesiumMath.toRadians(p.track);
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
        // Bank into turns a little, as the aircraft would.
        const ship = target.hex.startsWith('ship');
        const roll = ship ? 0 : CesiumMath.toRadians(Math.max(-25, Math.min(25, turnRate * 8)));
        camera.setView({
          destination: Cartesian3.fromDegrees(p.lon, p.lat, p.altM + 15),
          orientation: { heading: track, pitch: COCKPIT_PITCH, roll },
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
        holding = true;
        return;
      }

      if (mode === 'chase') {
        camera.lookAtTransform(enu, new HeadingPitchRange(track, CHASE_PITCH, range));
        holding = true;
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
      holding = true;
    },
  };
}
