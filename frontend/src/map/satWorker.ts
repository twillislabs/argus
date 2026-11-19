// SGP4 for the whole satellite catalogue, off the main thread.
//
// Messages in:
//   { type: 'load', fields, satellites }   the /api/satellites body
//   { type: 'tick', id, time }             positions of every satellite
//   { type: 'orbit', id, norad, time }     one orbit and the ground track
//   { type: 'passes', id, norad, time, lat, lon, hours }
// Messages out carry the same id. Positions are Earth-fixed metres
// (Cesium's fixed frame), NaN where propagation failed (decayed objects).

// The pure-JS parts of satellite.js (see the satellite-core alias in
// vite.config.ts).
import { json2satrec } from 'satellite-core/io.js';
import { gstime, propagate } from 'satellite-core/propagation.js';
import type { SatRec } from 'satellite-core/propagation/SatRec.js';
import {
  degreesLat,
  degreesLong,
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
} from 'satellite-core/transforms.js';

interface Entry {
  norad: number;
  rec: SatRec;
  periodMin: number;
}

let sats: Entry[] = [];

type Compact = (string | number | string[])[];

function toOmm(row: Compact) {
  const [norad, name, cospar, , , epoch, mm, ecc, inc, raan, argp, ma, bstar, ndot, nddot] = row;
  return {
    OBJECT_NAME: String(name),
    OBJECT_ID: String(cospar),
    EPOCH: String(epoch),
    MEAN_MOTION: Number(mm),
    ECCENTRICITY: Number(ecc),
    INCLINATION: Number(inc),
    RA_OF_ASC_NODE: Number(raan),
    ARG_OF_PERICENTER: Number(argp),
    MEAN_ANOMALY: Number(ma),
    EPHEMERIS_TYPE: 0 as const,
    CLASSIFICATION_TYPE: 'U' as const,
    NORAD_CAT_ID: Number(norad),
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 0,
    BSTAR: Number(bstar),
    MEAN_MOTION_DOT: Number(ndot),
    MEAN_MOTION_DDOT: Number(nddot),
  };
}

function ecf(rec: SatRec, date: Date): { x: number; y: number; z: number } | null {
  const pv = propagate(rec, date);
  if (!pv || typeof pv.position !== 'object' || !pv.position) return null;
  const f = eciToEcf(pv.position, gstime(date));
  if (!Number.isFinite(f.x)) return null;
  return f;
}

function find(norad: number): Entry | undefined {
  return sats.find((s) => s.norad === norad);
}

type Msg =
  | { type: 'load'; satellites: Compact[] }
  | { type: 'tick'; id: number; time: number }
  | { type: 'orbit'; id: number; norad: number; time: number }
  | { type: 'passes'; id: number; norad: number; time: number; lat: number; lon: number; hours: number };

self.onmessage = (event: MessageEvent<Msg>) => {
  const msg = event.data;
  if (msg.type === 'load') {
    const next: Entry[] = [];
    for (const row of msg.satellites) {
      try {
        const omm = toOmm(row);
        const rec = json2satrec(omm);
        next.push({ norad: omm.NORAD_CAT_ID, rec, periodMin: 1440 / omm.MEAN_MOTION });
      } catch {
        // Bad elements: leave it out.
      }
    }
    sats = next;
    const norads = new Int32Array(sats.map((s) => s.norad));
    (self as unknown as Worker).postMessage({ type: 'loaded', norads }, [norads.buffer]);
    return;
  }
  if (msg.type === 'tick') {
    const date = new Date(msg.time);
    const gmst = gstime(date);
    const out = new Float64Array(sats.length * 3);
    for (let i = 0; i < sats.length; i++) {
      const pv = propagate(sats[i].rec, date);
      const p = pv && typeof pv.position === 'object' ? pv.position : null;
      if (!p) {
        out[i * 3] = NaN;
        continue;
      }
      const f = eciToEcf(p, gmst);
      out[i * 3] = f.x * 1000;
      out[i * 3 + 1] = f.y * 1000;
      out[i * 3 + 2] = f.z * 1000;
    }
    (self as unknown as Worker).postMessage({ type: 'tick', id: msg.id, positions: out }, [out.buffer]);
    return;
  }
  const s = find(msg.norad);
  if (!s) {
    (self as unknown as Worker).postMessage({ type: msg.type, id: msg.id, error: 'unknown' });
    return;
  }
  if (msg.type === 'orbit') {
    // The orbit as a ring in space: inertial positions over one period,
    // drawn in the Earth-fixed frame of "now" so it doesn't smear into a
    // spiral. The ground track is where it actually passes overhead,
    // from half an orbit ago to one and a half ahead.
    const now = new Date(msg.time);
    const gmst = gstime(now);
    const periodMs = s.periodMin * 60_000;
    const steps = 180;
    const ring: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const d = new Date(msg.time + (periodMs * i) / steps);
      const pv = propagate(s.rec, d);
      const p = pv && typeof pv.position === 'object' ? pv.position : null;
      if (!p) continue;
      const f = eciToEcf(p, gmst);
      ring.push(f.x * 1000, f.y * 1000, f.z * 1000);
    }
    const track: number[] = [];
    let altKm = NaN;
    let speedKms = NaN;
    for (let i = -steps / 2; i <= (steps * 3) / 2; i++) {
      const d = new Date(msg.time + (periodMs * i) / steps);
      const pv = propagate(s.rec, d);
      const p = pv && typeof pv.position === 'object' ? pv.position : null;
      if (!p) continue;
      const g = eciToGeodetic(p, gstime(d));
      track.push(degreesLong(g.longitude), degreesLat(g.latitude));
      if (i === 0 && pv && typeof pv.velocity === 'object' && pv.velocity) {
        altKm = g.height;
        const v = pv.velocity;
        speedKms = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      }
    }
    (self as unknown as Worker).postMessage({
      type: 'orbit',
      id: msg.id,
      ring,
      track,
      altKm,
      speedKms,
      periodMin: s.periodMin,
    });
    return;
  }
  if (msg.type === 'passes') {
    // Passes above 10 degrees for an observer, stepping 30 s and
    // refining each rise and set to the second.
    const observer = {
      latitude: degreesToRadians(msg.lat),
      longitude: degreesToRadians(msg.lon),
      height: 0.2,
    };
    const elevation = (t: number) => {
      const f = ecf(s.rec, new Date(t));
      return f ? (ecfToLookAngles(observer, f).elevation * 180) / Math.PI : -90;
    };
    const minEl = 10;
    const end = msg.time + msg.hours * 3_600_000;
    const passes: { rise: number; set: number; peak: number; maxEl: number }[] = [];
    let prev = elevation(msg.time);
    let rise: number | null = prev >= minEl ? msg.time : null;
    let peak = msg.time;
    let maxEl = prev;
    for (let t = msg.time + 30_000; t <= end && passes.length < 12; t += 30_000) {
      const el = elevation(t);
      if (rise === null && el >= minEl && prev < minEl) {
        let lo = t - 30_000;
        let hi = t;
        while (hi - lo > 1000) {
          const mid = (lo + hi) / 2;
          if (elevation(mid) >= minEl) hi = mid;
          else lo = mid;
        }
        rise = hi;
        maxEl = el;
        peak = t;
      } else if (rise !== null) {
        if (el > maxEl) {
          maxEl = el;
          peak = t;
        }
        if (el < minEl) {
          let lo = t - 30_000;
          let hi = t;
          while (hi - lo > 1000) {
            const mid = (lo + hi) / 2;
            if (elevation(mid) >= minEl) lo = mid;
            else hi = mid;
          }
          passes.push({ rise, set: lo, peak, maxEl });
          rise = null;
          maxEl = -90;
        }
      }
      prev = el;
    }
    // Still up at the end (geostationary, or a pass in progress).
    if (rise !== null && passes.length < 12) passes.push({ rise, set: end, peak, maxEl });
    (self as unknown as Worker).postMessage({ type: 'passes', id: msg.id, passes });
  }
};
