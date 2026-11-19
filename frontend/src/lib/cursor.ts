// Where the cursor is on the globe and how high the camera is, shared by
// the globe (which writes it) and the readout (which shows it) without
// re-rendering the map page on every mouse move.

export interface CursorState {
  lat: number | null;
  lon: number | null;
  // Camera height above the ellipsoid, metres.
  eyeAlt: number;
  // Ground metres per screen pixel at the bottom centre of the map, or
  // null when that point is off the globe.
  metresPerPixel: number | null;
}

let state: CursorState = { lat: null, lon: null, eyeAlt: 0, metresPerPixel: null };
const listeners = new Set<() => void>();

export function setCursor(next: Partial<CursorState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const cursorStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => state,
};
