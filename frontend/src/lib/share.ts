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
const EVENT_LAYERS = ['conflict', 'unrest', 'quake', 'fire', 'hazard', 'maritime'] as const;
const REF_LAYERS = ['borders', 'states', 'labels', 'airports', 'ports'] as const;
const SPACE_LAYERS = ['leo', 'meo', 'geo', 'heo', 'starlink'] as const;
const SEA_LAYERS = ['cargo', 'tanker', 'passenger', 'fishing', 'military', 'other'] as const;
const AIRSPACE_LAYERS = ['tfr', 'sigmet', 'czib', 'gps', 'structure'] as const;
const INFRA_LAYERS = ['nuclear', 'power', 'cables', 'bases'] as const;

export interface Share {
  camera?: string;
  basemap?: Basemap;
  layers?: string[];
  eventId?: string;
  hex?: string;
  view?: CameraMode;
  norad?: number;
  mmsi?: number;
}

export function enabledLayers(f: LayerFilters): string[] {
  const on: string[] = EVENT_LAYERS.filter((t) => f.types[t]);
  if (f.air.military) on.push('mil');
  if (f.air.civil) on.push('civil');
  for (const r of REF_LAYERS) if (f.reference[r]) on.push(r);
  for (const r of SPACE_LAYERS) if (f.space[r]) on.push(r);
  for (const r of SEA_LAYERS) if (f.sea[r]) on.push('sea-' + r);
  for (const r of AIRSPACE_LAYERS) if (f.airspace[r]) on.push(r);
  for (const r of INFRA_LAYERS) if (f.infra[r]) on.push(r);
  if (f.tension) on.push('tension');
  return on;
}

export function applyLayers(f: LayerFilters, on: string[]): LayerFilters {
  const has = (id: string) => on.includes(id);
  return {
    ...f,
    types: {
      conflict: has('conflict'),
      unrest: has('unrest'),
      quake: has('quake'),
      fire: has('fire'),
      hazard: has('hazard'),
      maritime: has('maritime'),
    },
    air: { ...f.air, military: has('mil'), civil: has('civil'), focus: '' },
    reference: {
      borders: has('borders'),
      states: has('states'),
      labels: has('labels'),
      airports: has('airports'),
      ports: has('ports'),
      // A look preference, not part of the shared picture: keep yours.
      basemapLabels: f.reference.basemapLabels,
    },
    space: { leo: has('leo'), meo: has('meo'), geo: has('geo'), heo: has('heo'), starlink: has('starlink') },
    sea: {
      cargo: has('sea-cargo'),
      tanker: has('sea-tanker'),
      passenger: has('sea-passenger'),
      fishing: has('sea-fishing'),
      military: has('sea-military'),
      other: has('sea-other'),
    },
    airspace: {
      tfr: has('tfr'),
      sigmet: has('sigmet'),
      czib: has('czib'),
      gps: has('gps'),
      structure: has('structure'),
    },
    infra: { nuclear: has('nuclear'), power: has('power'), cables: has('cables'), bases: has('bases') },
    tension: has('tension'),
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
  mmsi: number | null;
}): string {
  const p = new URLSearchParams();
  if (s.camera) p.set('v', s.camera);
  p.set('b', s.basemap);
  p.set('l', enabledLayers(s.filters).join('.'));
  if (s.hex) {
    p.set('ac', s.hex);
    if (s.view !== 'free') p.set('cam', s.view);
  } else if (s.mmsi) {
    p.set('ship', String(s.mmsi));
    if (s.view !== 'free') p.set('cam', s.view);
  } else if (s.norad) p.set('sat', String(s.norad));
  else if (s.eventId) p.set('e', s.eventId);
  return location.origin + '/#' + p.toString();
}

function parse(hash: string): Share | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (!p.has('v') && !p.has('ac') && !p.has('e') && !p.has('sat') && !p.has('ship')) return null;
  const ship = Number(p.get('ship'));
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
    mmsi: Number.isInteger(ship) && ship > 0 ? ship : undefined,
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

// Where the map should open next (set by the Brief page's theatre cards,
// picked up once by MapPage's applyShare).
export const FLY_KEY = 'argus-fly';
