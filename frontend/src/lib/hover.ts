// The map item under the pointer, written by the globe and read by the
// hover card, without re-rendering the map page on every move.

export interface HoverState {
  id: string;
  x: number;
  y: number;
}

let state: HoverState | null = null;
const listeners = new Set<() => void>();

export function setHover(next: HoverState | null) {
  if (
    state === next ||
    (state && next && state.id === next.id && Math.abs(state.x - next.x) + Math.abs(state.y - next.y) < 3)
  ) {
    return;
  }
  state = next;
  for (const l of listeners) l();
}

export const hoverStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => state,
};
