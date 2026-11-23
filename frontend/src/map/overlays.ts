// Reference overlays drawn over any base map: country borders, state and
// province borders, place labels (countries and cities) and airports.
// Data is bundled in public/data: Natural Earth (public domain), GeoNames
// cities of 200,000+ (CC BY 4.0) and OurAirports large airports.

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import {
  HorizontalOrigin,
  type Label,
  LabelCollection,
  LabelStyle,
  type PointPrimitive,
  PointPrimitiveCollection,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';
import { feature, mesh } from 'topojson-client';
import { type LineBatch, lineBatch } from './lineBatch';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { currentTheme, onThemeChange } from '../lib/themes';

export interface ReferenceLayers {
  borders: boolean;
  states: boolean;
  labels: boolean;
  airports: boolean;
  ports: boolean;
  // The basemap's own names and roads (Esri / Google reference tiles).
  basemapLabels: boolean;
  // US / UK travel advisories (map/advisoryLayer.ts).
  advisories: boolean;
}

export const DEFAULT_REFERENCE: ReferenceLayers = {
  borders: true,
  states: false,
  labels: true,
  airports: false,
  ports: false,
  basemapLabels: true,
  advisories: false,
};

// Line colours differ over imagery (light) and the dark map (muted).
const STYLE = {
  // The mock-up's dark map: borders a faint blue-grey, names muted.
  dark: {
    border: 'rgba(120,135,155,0.42)',
    state: 'rgba(120,135,155,0.24)',
    city: '#c2cad6',
    country: '#6f7a89',
  },
  imagery: {
    border: 'rgba(255,255,255,0.75)',
    state: 'rgba(255,255,255,0.45)',
    city: '#ffffff',
    country: '#e8edf3',
  },
  // A light theme's map (Daylight): dark names on a white halo.
  light: {
    border: 'rgba(80,95,115,0.45)',
    state: 'rgba(80,95,115,0.25)',
    city: '#1d2633',
    country: '#5a6576',
  },
};
// The halo round names: dark, or white on a light theme's map.
const halo = (s: (typeof STYLE)[keyof typeof STYLE]) =>
  Color.fromCssColorString(s === STYLE.light ? '#ffffff' : '#05080e');
const darkStyle = () => (currentTheme().lightMap ? STYLE.light : STYLE.dark);

const LINE_HEIGHT = 800;
// Country borders from 50m data look right below this height; above it
// the dark map's own 110m borders are enough.
const STATE_RANGE = new DistanceDisplayCondition(0, 6.0e6);
const AIRPORT_RANGE = new DistanceDisplayCondition(0, 1.2e6);
const SEA_PORT_RANGE = new DistanceDisplayCondition(0, 1.5e6);
const INLAND_PORT_RANGE = new DistanceDisplayCondition(0, 4.0e5);
const PORT_LABEL_RANGE = new DistanceDisplayCondition(0, 1.2e5);

function cityRange(population: number): DistanceDisplayCondition {
  if (population >= 5_000_000) return new DistanceDisplayCondition(0, 9.0e6);
  if (population >= 1_000_000) return new DistanceDisplayCondition(0, 4.0e6);
  if (population >= 500_000) return new DistanceDisplayCondition(0, 1.6e6);
  return new DistanceDisplayCondition(0, 7.0e5);
}

type Position = number[];

// A label is about 80 px wide, and at camera distance D one pixel covers
// roughly D / 800 metres, so two names overlap once D > ~10 × their
// separation. Each city may show only while the camera is closer than
// that to its nearest bigger neighbour (Fort Worth waits for Dallas to
// spread out; a suburb never crowds its city).
const LABEL_ROOM = 10;

function declutter(cities: [string, number, number, number][]): number[] {
  const order = cities.map((_, i) => i).sort((a, b) => cities[b][3] - cities[a][3]);
  const room = new Array<number>(cities.length).fill(Number.POSITIVE_INFINITY);
  // 1-degree grid of the cities placed so far (bigger first).
  const grid = new Map<string, number[]>();
  const cell = (lon: number, lat: number) => Math.floor(lon) + ',' + Math.floor(lat);
  for (const i of order) {
    const [, lon, lat] = cities[i];
    let nearest = Number.POSITIVE_INFINITY;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (const j of grid.get(cell(lon + dx, lat + dy)) ?? []) {
          const [, lon2, lat2] = cities[j];
          const x = (lon2 - lon) * Math.cos((lat * Math.PI) / 180);
          const km = Math.hypot(x, lat2 - lat) * 111.32;
          if (km < nearest) nearest = km;
        }
      }
    }
    room[i] = nearest * 1000 * LABEL_ROOM;
    const k = cell(lon, lat);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  }
  return room;
}

// Join pieces that meet end to start into longer lines (the admin-1 data
// is some 44,000 short pieces), so there are far fewer lines to build.
function joinLines(lines: Position[][]): Position[][] {
  const key = (p: Position) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  const byStart = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (l.length < 2) return;
    const k = key(l[0]);
    const list = byStart.get(k);
    if (list) list.push(i);
    else byStart.set(k, [i]);
  });
  const used = new Uint8Array(lines.length);
  const out: Position[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i] || lines[i].length < 2) continue;
    used[i] = 1;
    const line = [...lines[i]];
    for (;;) {
      const next = (byStart.get(key(line[line.length - 1])) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      for (const p of lines[next].slice(1)) line.push(p);
    }
    out.push(line);
  }
  return out;
}

// The admin-1 lines are delta-encoded at 0.01 degrees:
// [x0, y0, dx1, dy1, dx2, dy2, ...].
function decodeAdmin1(raw: number[][]): Position[][] {
  return raw.map((flat) => {
    let x = flat[0];
    let y = flat[1];
    const pts: Position[] = [[x / 100, y / 100]];
    for (let i = 2; i < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      pts.push([x / 100, y / 100]);
    }
    return pts;
  });
}

// A country's label point: the centre of its largest ring's bounding box,
// nudged to the ring's vertex average (good enough for labels).
function labelPoint(geometry: GeoJSON.Geometry): { at: [number, number]; area: number } | null {
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let best: Position[] | null = null;
  let bestArea = 0;
  for (const rings of polys) {
    const ring = rings[0];
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area);
      best = ring;
    }
  }
  if (!best) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of best) {
    sx += x;
    sy += y;
  }
  return { at: [sx / best.length, sy / best.length], area: bestArea / 2 };
}

// Big countries are labelled from far out; small ones only closer in, so
// the world view isn't a pile of overlapping names.
function countryRange(areaDeg2: number): DistanceDisplayCondition {
  if (areaDeg2 >= 150) return new DistanceDisplayCondition(1.8e6, 2.4e7);
  if (areaDeg2 >= 25) return new DistanceDisplayCondition(1.2e6, 1.3e7);
  if (areaDeg2 >= 4) return new DistanceDisplayCondition(8.0e5, 7.0e6);
  return new DistanceDisplayCondition(4.0e5, 3.0e6);
}

export type LabelMode = 'dark' | 'satellite' | 'hybrid';

// Argus names places down to this height. Below it the Dark and Hybrid
// maps' own label tiles fade in (Globe.tsx) and Argus's labels step
// aside, so names are never doubled. With Basemap labels off, Argus
// labels all the way down.
export const TILE_LABELS_BELOW = 3.0e5;
const COUNTRY_LABELS_BELOW = 9.0e6;

// [code, name, lon, lat]: OurAirports large airports (IATA code).
export type Airport = [string, string, number, number];
// [UN/LOCODE, name, country, lon, lat, sea (1) or inland (0)].
export type Port = [string, string, string, number, number, number];

export interface Overlays {
  // Picked as 'apt:<index>' and 'port:<index>'.
  airport: (index: number) => Airport | null;
  port: (index: number) => Port | null;
  // Ring colours for airports by code (FAA ground stops and delays).
  setAirportRings: (colors: Record<string, string>) => void;
  setLayers: (layers: ReferenceLayers) => void;
  setImagery: (mode: LabelMode) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function addOverlays(scene: Scene): Promise<Overlays> {
  const labels = new LabelCollection({ scene });
  const airportDots = new PointPrimitiveCollection();
  const airportLabels = new LabelCollection({ scene });
  const portDots = new PointPrimitiveCollection();
  const portLabels = new LabelCollection({ scene });
  for (const p of [airportDots, portDots, labels, airportLabels, portLabels]) scene.primitives.add(p);

  let style = darkStyle();
  // Names and borders in the style for the base map and theme; again
  // when either changes.
  const restyle = () => {
    const next = mode === 'dark' ? darkStyle() : STYLE.imagery;
    if (next === style) return;
    style = next;
    borders?.setColor(style.border);
    states?.setColor(style.state);
    const city = Color.fromCssColorString(style.city);
    const country = Color.fromCssColorString(style.country);
    const edge = halo(style);
    for (const { label } of cityLabels) {
      label.fillColor = city;
      label.outlineColor = edge;
    }
    for (const { label } of countryLabels) {
      label.fillColor = country;
      label.outlineColor = edge;
    }
    scene.requestRender();
  };
  // Borders are batched into one primitive each (see lineBatch.ts).
  let borders: LineBatch | null = null;
  let states: LineBatch | null = null;
  let stateLines: number[][] | null = null;
  const countryLabels: { label: Label; area: number }[] = [];
  // maxFar: the camera distance below which a city's name no longer runs
  // into a bigger city's nearby (see declutter below).
  const cityLabels: { label: Label; pop: number; maxFar: number }[] = [];

  const [topo, admin1, cities, airports, ports] = await Promise.all([
    json<Topology>('/data/countries-50m.json'),
    json<number[][]>('/data/admin1-lines.json'),
    json<[string, number, number, number][]>('/data/cities.json'),
    json<Airport[]>('/data/airports.json'),
    json<Port[]>('/data/ports.json'),
  ]);

  if (topo) {
    const countries = topo.objects.countries as GeometryCollection;
    const lines = mesh(topo, countries, (a, b) => a !== b) as unknown as GeoJSON.MultiLineString;
    borders = lineBatch(scene, lines.coordinates, style.border, 1.2, LINE_HEIGHT);
    scene.primitives.add(borders.primitive);
    const fc = feature(topo, countries) as unknown as GeoJSON.FeatureCollection;
    for (const f of fc.features) {
      const name = (f.properties as { name?: string } | null)?.name;
      const point = f.geometry ? labelPoint(f.geometry) : null;
      if (!name || !point || name === 'Antarctica') continue;
      const at = point.at;
      countryLabels.push({
        area: point.area,
        label: labels.add({
          position: Cartesian3.fromDegrees(at[0], at[1], 2000),
          text: name.toUpperCase(),
          font: '600 11px "Barlow Semi Condensed", "Arial Narrow", sans-serif',
          fillColor: Color.fromCssColorString(style.country),
          outlineColor: halo(style),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          // Countries label the wide views; cities take over closer in.
          distanceDisplayCondition: countryRange(point.area),
          scaleByDistance: new NearFarScalar(2.0e6, 1.1, 2.0e7, 0.8),
        }),
      });
    }
  }

  if (admin1) {
    // Built the first time the layer is switched on (see apply).
    stateLines = admin1;
  }

  if (cities) {
    const room = declutter(cities);
    cities.forEach(([name, lon, lat, pop], i) => {
      cityLabels.push({
        pop,
        maxFar: room[i],
        label: labels.add({
          position: Cartesian3.fromDegrees(lon, lat, 1500),
          text: name,
          font: (pop >= 1_000_000 ? '600 12px' : '500 11px') + ' Inter, system-ui, sans-serif',
          fillColor: Color.fromCssColorString(style.city),
          outlineColor: halo(style),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -4),
          distanceDisplayCondition: cityRange(pop),
        }),
      });
    });
  }

  if (airports) {
    airports.forEach(([code, , lon, lat], i) => {
      const position = Cartesian3.fromDegrees(lon, lat, 1200);
      airportDots.add({
        id: 'apt:' + i,
        position,
        pixelSize: 6,
        color: Color.fromCssColorString('#0b0e13'),
        outlineColor: Color.fromCssColorString('#b4c2d4'),
        outlineWidth: 1.5,
        distanceDisplayCondition: AIRPORT_RANGE,
      });
      airportLabels.add({
        position,
        id: 'apt:' + i,
        text: code,
        font: '600 10.5px "JetBrains Mono", monospace',
        fillColor: Color.fromCssColorString('#b4c2d4'),
        outlineColor: Color.fromCssColorString('#05080e'),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(7, 0),
        distanceDisplayCondition: AIRPORT_RANGE,
      });
    });
  }

  if (ports) {
    // UN/LOCODE ports: sea ports (near the coast) from further out than
    // river and inland ports. Only sea ports get names.
    const teal = Color.fromCssColorString('#4fc1b0');
    const dark = Color.fromCssColorString('#0b0e13');
    ports.forEach(([, name, , lon, lat, sea], i) => {
      const position = Cartesian3.fromDegrees(lon, lat, 1000);
      portDots.add({
        id: 'port:' + i,
        position,
        pixelSize: sea ? 5 : 4,
        color: dark,
        outlineColor: sea ? teal : teal.withAlpha(0.6),
        outlineWidth: 1.5,
        distanceDisplayCondition: sea ? SEA_PORT_RANGE : INLAND_PORT_RANGE,
      });
      if (!sea) return;
      portLabels.add({
        id: 'port:' + i,
        position,
        text: name,
        font: '500 10.5px Inter, system-ui, sans-serif',
        fillColor: teal,
        outlineColor: Color.fromCssColorString('#05080e'),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(7, 0),
        distanceDisplayCondition: PORT_LABEL_RANGE,
      });
    });
  }

  let layers = DEFAULT_REFERENCE;
  let mode: LabelMode = 'dark';
  // Satellite has no names of its own, and Basemap labels can be off:
  // then Argus shows every label. Otherwise only above the height where
  // the tiles' own names take over.
  function placeLabels() {
    const tiles = mode !== 'satellite' && layers.basemapLabels;
    for (const { label, pop, maxFar } of cityLabels) {
      const base = cityRange(pop);
      const range = new DistanceDisplayCondition(base.near, Math.min(base.far, maxFar));
      const near = tiles ? TILE_LABELS_BELOW : range.near;
      // Cesium throws unless far > near: hide labels with nothing left.
      label.show = range.far > near;
      if (label.show) label.distanceDisplayCondition = new DistanceDisplayCondition(near, range.far);
    }
    for (const { label, area } of countryLabels) {
      const range = countryRange(area);
      const near = tiles ? Math.max(range.near, TILE_LABELS_BELOW) : range.near;
      // The whole-globe view stays clean, as in the mock-up: country
      // names appear once you're zoomed in to a continent.
      const far = Math.min(range.far, COUNTRY_LABELS_BELOW);
      label.show = far > near;
      if (label.show) label.distanceDisplayCondition = new DistanceDisplayCondition(near, far);
    }
  }
  function apply() {
    if (borders) borders.primitive.show = layers.borders;
    if (layers.states && !states && stateLines) {
      // Some 44,000 pieces, joined into about 13,000 lines and batched
      // into one draw call (a polyline each made the map crawl).
      states = lineBatch(scene, joinLines(decodeAdmin1(stateLines)), style.state, 1, LINE_HEIGHT, STATE_RANGE);
      scene.primitives.add(states.primitive);
      stateLines = null;
    }
    if (states) states.primitive.show = layers.states;
    labels.show = layers.labels;
    airportDots.show = layers.airports;
    airportLabels.show = layers.airports;
    portDots.show = layers.ports;
    portLabels.show = layers.ports;
  }
  apply();

  // Registered last: restyle reads state declared above.
  const stopTheme = onThemeChange(() => restyle());
  return {
    airport: (index) => (layers.airports && airports?.[index]) || null,
    port: (index) => (layers.ports && ports?.[index]) || null,
    setAirportRings(colors) {
      if (!airports) return;
      const plain = Color.fromCssColorString('#b4c2d4');
      for (let i = 0; i < airportDots.length && i < airports.length; i++) {
        const c = colors[airports[i][0]];
        const dot = airportDots.get(i) as PointPrimitive;
        dot.outlineColor = c ? Color.fromCssColorString(c) : plain;
        dot.outlineWidth = c ? 2.5 : 1.5;
        dot.pixelSize = c ? 8 : 6;
      }
    },
    setLayers(next) {
      layers = next;
      apply();
      placeLabels();
    },
    setImagery(nextMode) {
      mode = nextMode;
      placeLabels();
      restyle();
    },
    setDepthDistance(metres) {
      for (const c of [labels, airportLabels, portLabels]) {
        for (let i = 0; i < c.length; i++) c.get(i).disableDepthTestDistance = metres;
      }
      for (const dots of [airportDots, portDots]) {
        for (let i = 0; i < dots.length; i++) {
          (dots.get(i) as PointPrimitive).disableDepthTestDistance = metres;
        }
      }
    },
    destroy() {
      stopTheme();
      if (scene.isDestroyed()) return;
      const batches = [borders?.primitive, states?.primitive].filter((p): p is NonNullable<typeof p> => Boolean(p));
      for (const p of [...batches, airportDots, portDots, labels, airportLabels, portLabels]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
