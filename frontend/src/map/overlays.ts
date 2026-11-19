// Reference overlays drawn over any base map: country borders, state and
// province borders, place labels (countries and cities) and airports.
// Data is bundled in public/data: Natural Earth (public domain), GeoNames
// cities of 200,000+ (CC BY 4.0) and OurAirports large airports.

import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
} from '@cesium/core';
import {
  HorizontalOrigin,
  type Label,
  LabelCollection,
  LabelStyle,
  Material,
  type PointPrimitive,
  PointPrimitiveCollection,
  PolylineCollection,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

export interface ReferenceLayers {
  borders: boolean;
  states: boolean;
  labels: boolean;
  airports: boolean;
  ports: boolean;
}

export const DEFAULT_REFERENCE: ReferenceLayers = {
  borders: true,
  states: false,
  labels: true,
  airports: false,
  ports: false,
};

// Line colours differ over imagery (light) and the dark map (muted).
const STYLE = {
  dark: { border: 'rgba(150,165,185,0.55)', state: 'rgba(120,135,155,0.38)', city: '#c2cad6', country: '#7d8898' },
  imagery: { border: 'rgba(255,255,255,0.75)', state: 'rgba(255,255,255,0.45)', city: '#ffffff', country: '#e8edf3' },
};

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

function flatten(line: Position[], height: number): number[] {
  const out: number[] = [];
  for (const [lon, lat] of line) out.push(lon, lat, height);
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
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
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

// Below this height the Dark and Hybrid maps' own tiles carry place names,
// so Argus's city labels step aside instead of doubling them.
const TILE_LABELS_BELOW = 2.6e6;
// The tiles name countries from about here down.
const COUNTRY_TILES_BELOW = 3.2e6;

export interface Overlays {
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
  const borders = new PolylineCollection();
  const states = new PolylineCollection();
  const labels = new LabelCollection({ scene });
  const airportDots = new PointPrimitiveCollection();
  const airportLabels = new LabelCollection({ scene });
  const portDots = new PointPrimitiveCollection();
  const portLabels = new LabelCollection({ scene });
  for (const p of [borders, states, airportDots, portDots, labels, airportLabels, portLabels]) scene.primitives.add(p);

  let style = STYLE.dark;
  const borderMaterials: Material[] = [];
  const stateMaterials: Material[] = [];
  const countryLabels: { label: Label; area: number }[] = [];
  const cityLabels: { label: Label; pop: number }[] = [];

  const [topo, admin1, cities, airports, ports] = await Promise.all([
    json<Topology>('/data/countries-50m.json'),
    json<number[][]>('/data/admin1-lines.json'),
    json<[string, number, number, number][]>('/data/cities.json'),
    json<[string, string, number, number][]>('/data/airports.json'),
    json<[string, string, string, number, number, number][]>('/data/ports.json'),
  ]);

  if (topo) {
    const countries = topo.objects.countries as GeometryCollection;
    const lines = mesh(topo, countries, (a, b) => a !== b) as unknown as GeoJSON.MultiLineString;
    for (const line of lines.coordinates) {
      if (line.length < 2) continue;
      const material = Material.fromType('Color', { color: Color.fromCssColorString(style.border) });
      borderMaterials.push(material);
      borders.add({ positions: Cartesian3.fromDegreesArrayHeights(flatten(line, LINE_HEIGHT)), width: 1.2, material });
    }
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
          outlineColor: Color.fromCssColorString('#05080e'),
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
    for (const line of decodeAdmin1(admin1)) {
      if (line.length < 2) continue;
      const material = Material.fromType('Color', { color: Color.fromCssColorString(style.state) });
      stateMaterials.push(material);
      states.add({
        positions: Cartesian3.fromDegreesArrayHeights(flatten(line, LINE_HEIGHT)),
        width: 1,
        material,
        distanceDisplayCondition: STATE_RANGE,
      });
    }
  }

  if (cities) {
    for (const [name, lon, lat, pop] of cities) {
      cityLabels.push({
        pop,
        label: labels.add({
          position: Cartesian3.fromDegrees(lon, lat, 1500),
          text: name,
          font: (pop >= 1_000_000 ? '600 12px' : '500 11px') + ' Inter, system-ui, sans-serif',
          fillColor: Color.fromCssColorString(style.city),
          outlineColor: Color.fromCssColorString('#05080e'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -4),
          distanceDisplayCondition: cityRange(pop),
        }),
      });
    }
  }

  if (airports) {
    for (const [code, , lon, lat] of airports) {
      const position = Cartesian3.fromDegrees(lon, lat, 1200);
      airportDots.add({
        position,
        pixelSize: 6,
        color: Color.fromCssColorString('#0b0e13'),
        outlineColor: Color.fromCssColorString('#b4c2d4'),
        outlineWidth: 1.5,
        distanceDisplayCondition: AIRPORT_RANGE,
      });
      airportLabels.add({
        position,
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
    }
  }

  if (ports) {
    // UN/LOCODE ports: sea ports (near the coast) from further out than
    // river and inland ports. Only sea ports get names.
    const teal = Color.fromCssColorString('#4fc1b0');
    const dark = Color.fromCssColorString('#0b0e13');
    for (const [, name, , lon, lat, sea] of ports) {
      const position = Cartesian3.fromDegrees(lon, lat, 1000);
      portDots.add({
        position,
        pixelSize: sea ? 5 : 4,
        color: dark,
        outlineColor: sea ? teal : teal.withAlpha(0.6),
        outlineWidth: 1.5,
        distanceDisplayCondition: sea ? SEA_PORT_RANGE : INLAND_PORT_RANGE,
      });
      if (!sea) continue;
      portLabels.add({
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
    }
  }

  let layers = DEFAULT_REFERENCE;
  function apply() {
    borders.show = layers.borders;
    states.show = layers.states;
    labels.show = layers.labels;
    airportDots.show = layers.airports;
    airportLabels.show = layers.airports;
    portDots.show = layers.ports;
    portLabels.show = layers.ports;
  }
  apply();

  return {
    setLayers(next) {
      layers = next;
      apply();
    },
    setImagery(mode) {
      // Satellite has no names of its own: show every city label.
      // Dark and Hybrid: only from heights where the tiles don't label.
      for (const { label, pop } of cityLabels) {
        const range = cityRange(pop);
        if (mode === 'satellite') {
          label.distanceDisplayCondition = range;
          label.show = true;
        } else if (range.far > TILE_LABELS_BELOW) {
          label.distanceDisplayCondition = new DistanceDisplayCondition(TILE_LABELS_BELOW, range.far);
          label.show = true;
        } else {
          // Only ever shown below the tiles' own labels: leave it to them.
          // (A condition needs far > near, so hide it instead.)
          label.show = false;
        }
      }
      // Country names too: the tiles carry them once they fade in.
      for (const { label, area } of countryLabels) {
        const range = countryRange(area);
        const near = mode === 'satellite' ? range.near : Math.max(range.near, COUNTRY_TILES_BELOW);
        // Cesium throws unless far > near: hide labels with nothing left.
        label.show = range.far > near;
        if (label.show) label.distanceDisplayCondition = new DistanceDisplayCondition(near, range.far);
      }
      const next = mode === 'dark' ? STYLE.dark : STYLE.imagery;
      if (next === style) return;
      style = next;
      const border = Color.fromCssColorString(style.border);
      const state = Color.fromCssColorString(style.state);
      for (const m of borderMaterials) m.uniforms.color = border;
      for (const m of stateMaterials) m.uniforms.color = state;
      const city = Color.fromCssColorString(style.city);
      const country = Color.fromCssColorString(style.country);
      for (const { label } of cityLabels) label.fillColor = city;
      for (const { label } of countryLabels) label.fillColor = country;
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
      if (scene.isDestroyed()) return;
      for (const p of [borders, states, airportDots, portDots, labels, airportLabels, portLabels]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
