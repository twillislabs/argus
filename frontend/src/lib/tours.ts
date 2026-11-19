// Director mode: tours are saved map views (shots) with captions, flown
// through in order. Saved in the `tours` preference; shared as a link
// (/#tour=<base64url JSON>), which opens and plays the tour.

export interface TourShot {
  camera: string; // GlobeHandle.cameraString(): lon,lat,height,heading,pitch
  caption: string;
  fly_s: number;
  hold_s: number;
}

export interface Tour {
  id: string;
  name: string;
  loop: boolean;
  shots: TourShot[];
}

export const MAX_TOURS = 30;
export const MAX_SHOTS = 40;

export const newTourId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const newShot = (camera: string): TourShot => ({ camera, caption: '', fly_s: 3, hold_s: 6 });

const CAMERA = /^-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?,\d{1,8}(,-?\d{1,3}(\.\d+)?){0,2}$/;

// A tour from untrusted JSON (a link or old preferences), or null.
export function cleanTour(x: unknown): Tour | null {
  if (!x || typeof x !== 'object') return null;
  const t = x as Partial<Tour>;
  const shots = (Array.isArray(t.shots) ? t.shots : [])
    .filter((s): s is TourShot => Boolean(s) && typeof s.camera === 'string' && CAMERA.test(s.camera))
    .slice(0, MAX_SHOTS)
    .map((s) => ({
      camera: s.camera,
      caption: typeof s.caption === 'string' ? s.caption.slice(0, 200) : '',
      fly_s: clamp(Number(s.fly_s), 0, 30, 3),
      hold_s: clamp(Number(s.hold_s), 1, 600, 6),
    }));
  const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 60) : 'Shared tour';
  const id = typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(t.id) ? t.id : newTourId();
  return shots.length ? { id, name, loop: Boolean(t.loop), shots } : null;
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export function tourLink(t: Tour): string {
  const json = JSON.stringify({ name: t.name, loop: t.loop, shots: t.shots });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return location.origin + '/#tour=' + b64;
}

export function decodeTour(b64: string): Tour | null {
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return cleanTour(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
