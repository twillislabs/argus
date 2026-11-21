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

// The Sun's position (Earth-centred inertial, km), to about 0.01 degrees:
// the Astronomical Almanac's low-precision formula.
const AU_KM = 149_597_870.7;
function sunEci(date: Date): { x: number; y: number; z: number } {
  const n = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const rad = Math.PI / 180;
  const g = (357.528 + 0.9856003 * n) * rad;
  const lambda = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM;
  return {
    x: r * Math.cos(lambda),
    y: r * Math.cos(eps) * Math.sin(lambda),
    z: r * Math.sin(eps) * Math.sin(lambda),
  };
}

// Whether a satellite (ECI, km) is in sunlight: outside Earth's shadow,
// taken as a cylinder (close enough for a yes/no).
const EARTH_KM = 6378.137;
function sunlit(sat: { x: number; y: number; z: number }, sun: { x: number; y: number; z: number }): boolean {
  const len = Math.hypot(sun.x, sun.y, sun.z);
  const ux = sun.x / len;
  const uy = sun.y / len;
  const uz = sun.z / len;
  const along = sat.x * ux + sat.y * uy + sat.z * uz;
  if (along > 0) return true;
  const px = sat.x - along * ux;
  const py = sat.y - along * uy;
  const pz = sat.z - along * uz;
  return Math.hypot(px, py, pz) > EARTH_KM;
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
    // refining each rise and set to the second, with the compass
    // bearings it rises and sets at and whether it can be seen with the
    // eye (sunlit while the observer's sky is dark: Sun 6 degrees or
    // more below the horizon) at any point.
    const observer = {
      latitude: degreesToRadians(msg.lat),
      longitude: degreesToRadians(msg.lon),
      height: 0.2,
    };
    const look = (t: number) => {
      const f = ecf(s.rec, new Date(t));
      return f ? ecfToLookAngles(observer, f) : null;
    };
    const elevation = (t: number) => {
      const a = look(t);
      return a ? (a.elevation * 180) / Math.PI : -90;
    };
    const azimuth = (t: number) => {
      const a = look(t);
      return a ? Math.round(((((a.azimuth * 180) / Math.PI) % 360) + 360) % 360) : 0;
    };
    const seen = (t: number) => {
      const date = new Date(t);
      const sun = sunEci(date);
      const sunLook = ecfToLookAngles(observer, eciToEcf(sun, gstime(date)));
      if ((sunLook.elevation * 180) / Math.PI > -6) return false;
      const pv = propagate(s.rec, date);
      return Boolean(pv && typeof pv.position === 'object' && pv.position && sunlit(pv.position, sun));
    };
    const minEl = 10;
    const end = msg.time + msg.hours * 3_600_000;
    const passes: {
      rise: number;
      set: number;
      peak: number;
      maxEl: number;
      riseAz: number;
      setAz: number;
      visible: boolean;
    }[] = [];
    let visible = false;
    let prev = elevation(msg.time);
    let rise: number | null = prev >= minEl ? msg.time : null;
    if (rise !== null) visible = seen(msg.time);
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
        visible = seen(t);
      } else if (rise !== null) {
        if (el > maxEl) {
          maxEl = el;
          peak = t;
        }
        if (el >= minEl && !visible) visible = seen(t);
        if (el < minEl) {
          let lo = t - 30_000;
          let hi = t;
          while (hi - lo > 1000) {
            const mid = (lo + hi) / 2;
            if (elevation(mid) >= minEl) lo = mid;
            else hi = mid;
          }
          passes.push({ rise, set: lo, peak, maxEl, riseAz: azimuth(rise), setAz: azimuth(lo), visible });
          rise = null;
          visible = false;
          maxEl = -90;
        }
      }
      prev = el;
    }
    // Still up at the end (geostationary, or a pass in progress).
    if (rise !== null && passes.length < 12)
      passes.push({ rise, set: end, peak, maxEl, riseAz: azimuth(rise), setAz: azimuth(end), visible });
    (self as unknown as Worker).postMessage({ type: 'passes', id: msg.id, passes });
  }
};
