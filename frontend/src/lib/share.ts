// Share links: the camera, base map, layers and one selection, in the
// URL hash, e.g. /#v=-86.78,36.16,40000,0,-90&b=dark&l=quake.mil&ac=a12345
//
//   v    lon,lat,height (m),heading,pitch (degrees)
//   b    base map
//   l    layers that are on, joined with "."
//   e    an event id to open, or
//   ac   an aircraft hex to select, with cam = its camera view

import type { LayerFilters } from '../components/LayerPanel';
import type { CameraMode } from '../map/aircraftCamera';
import type { Basemap } from '../map/Globe';

const KEY = 'argus-share';
const BASEMAPS: Basemap[] = ['dark', 'satellite', 'hybrid', 'photo3d'];
const VIEWS: CameraMode[] = ['free', 'follow', 'chase', 'orbit', 'cockpit'];
const EVENT_LAYERS = ['conflict', 'unrest', 'quake', 'fire'] as const;
const REF_LAYERS = ['borders', 'states', 'labels', 'airports'] as const;
const SPACE_LAYERS = ['leo', 'meo', 'geo', 'heo', 'starlink'] as const;

export interface Share {
  camera?: string;
  basemap?: Basemap;
  layers?: string[];
  eventId?: string;
  hex?: string;
  view?: CameraMode;
  norad?: number;
}

export function enabledLayers(f: LayerFilters): string[] {
  const on: string[] = EVENT_LAYERS.filter((t) => f.types[t]);
  if (f.air.military) on.push('mil');
  if (f.air.civil) on.push('civil');
  for (const r of REF_LAYERS) if (f.reference[r]) on.push(r);
  for (const r of SPACE_LAYERS) if (f.space[r]) on.push(r);
  return on;
}

export function applyLayers(f: LayerFilters, on: string[]): LayerFilters {
  const has = (id: string) => on.includes(id);
  return {
    ...f,
    types: { conflict: has('conflict'), unrest: has('unrest'), quake: has('quake'), fire: has('fire') },
    air: { ...f.air, military: has('mil'), civil: has('civil'), focus: '' },
    reference: { borders: has('borders'), states: has('states'), labels: has('labels'), airports: has('airports') },
    space: { leo: has('leo'), meo: has('meo'), geo: has('geo'), heo: has('heo'), starlink: has('starlink') },
  };
}

export function buildShareLink(s: {
  camera: string | null;
  basemap: Basemap;
  filters: LayerFilters;
  eventId: string | null;
  hex: string | null;
  view: CameraMode;
  norad: number | null;
}): string {
  const p = new URLSearchParams();
  if (s.camera) p.set('v', s.camera);
  p.set('b', s.basemap);
  p.set('l', enabledLayers(s.filters).join('.'));
  if (s.hex) {
    p.set('ac', s.hex);
    if (s.view !== 'free') p.set('cam', s.view);
  } else if (s.norad) p.set('sat', String(s.norad));
  else if (s.eventId) p.set('e', s.eventId);
  return location.origin + '/#' + p.toString();
}

function parse(hash: string): Share | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (!p.has('v') && !p.has('ac') && !p.has('e') && !p.has('sat')) return null;
  const sat = Number(p.get('sat'));
  const b = p.get('b') as Basemap | null;
  const cam = p.get('cam') as CameraMode | null;
  const hex = (p.get('ac') ?? '').toLowerCase();
  const eventId = p.get('e') ?? '';
  return {
    camera: p.get('v') ?? undefined,
    basemap: b && BASEMAPS.includes(b) ? b : undefined,
    layers: p.has('l') ? (p.get('l') ?? '').split('.').filter(Boolean) : undefined,
    hex: /^[0-9a-f]{6}$/.test(hex) ? hex : undefined,
    eventId: /^[A-Za-z0-9]{1,16}$/.test(eventId) ? eventId : undefined,
    view: cam && VIEWS.includes(cam) ? cam : undefined,
    norad: Number.isInteger(sat) && sat > 0 ? sat : undefined,
  };
}

// Called on boot: a share link survives the trip through sign-in.
export function stashShareLink(): void {
  if (!location.hash || !parse(location.hash)) return;
  try {
    sessionStorage.setItem(KEY, location.hash);
  } catch {
    // Storage blocked: the hash is still read directly if it survives.
  }
}

// The pending share link, once; clears it from the URL and storage.
export function takeShareLink(): Share | null {
  let hash = location.hash;
  try {
    hash = hash || sessionStorage.getItem(KEY) || '';
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked.
  }
  const share = hash ? parse(hash) : null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return share;
}
