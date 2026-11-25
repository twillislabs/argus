// "Argus Dark": the default map look from the design mock. Countries from
// Natural Earth (110m, bundled in public/data) drawn as graphite shapes on
// a near-black ocean, with borders, coastlines and a faint graticule. It
// needs no tile service; street detail fades in from tiles as you zoom.

import { ArcType, Cartesian3, Color, GeometryInstance, PolygonGeometry, PolygonHierarchy } from '@cesium/core';
import { Material, MaterialAppearance, PolylineCollection, Primitive, type Scene } from '@cesium/engine';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

export const DARK = {
  ocean: '#0a0f16',
  land: '#171c23',
  border: 'rgba(120,135,155,0.38)',
  coast: 'rgba(120,140,170,0.32)',
  graticule: 'rgba(120,140,170,0.13)',
  background: '#070a0e',
};

type Position = number[];
type Ring = Position[];

function flatten(line: Position[], height: number): number[] {
  const out: number[] = [];
  for (const [lon, lat] of line) out.push(lon, lat, height);
  return out;
}

function hierarchy(rings: Ring[]): PolygonHierarchy {
  const toPositions = (ring: Ring) =>
    Cartesian3.fromDegreesArray(ring.slice(0, -1).flatMap(([lon, lat]) => [lon, lat]));
  return new PolygonHierarchy(
    toPositions(rings[0]),
    rings.slice(1).map((r) => new PolygonHierarchy(toPositions(r))),
  );
}

export interface DarkMap {
  setFade: (landAlpha: number) => void;
  setVisible: (visible: boolean) => void;
  // The theme's map colours (lib/themes.ts MapKey values).
  setPalette: (p: Partial<typeof DARK>) => void;
  destroy: () => void;
}

export async function addDarkMap(scene: Scene): Promise<DarkMap> {
  const res = await fetch('/data/countries-110m.json');
  const topo = (await res.json()) as Topology;
  const countries = topo.objects.countries as GeometryCollection;
  const fc = feature(topo, countries) as unknown as GeoJSON.FeatureCollection;

  const instances: GeometryInstance[] = [];
  for (const f of fc.features) {
    // Antarctica's ring runs along the pole, which polygon fills can't
    // triangulate; its coastline is still drawn below.
    if ((f.properties as { name?: string })?.name === 'Antarctica') continue;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      if (!rings.length || rings[0].length < 4) continue;
      instances.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: hierarchy(rings as Ring[]),
            height: 300,
            arcType: ArcType.RHUMB,
            vertexFormat: MaterialAppearance.MaterialSupport.BASIC.vertexFormat,
          }),
        }),
      );
    }
  }
  const landMaterial = Material.fromType('Color', { color: Color.fromCssColorString(DARK.land) });
  const land = new Primitive({
    geometryInstances: instances,
    appearance: new MaterialAppearance({
      material: landMaterial,
      materialSupport: MaterialAppearance.MaterialSupport.BASIC,
      translucent: true,
      flat: true,
    }),
    asynchronous: true,
  });
  scene.primitives.add(land);

  const lines = new PolylineCollection();
  // Which palette colour each line takes, for setPalette.
  const kinds: ('border' | 'coast' | 'graticule')[] = [];
  const addLines = (geo: GeoJSON.MultiLineString, kind: 'border' | 'coast' | 'graticule', width: number) => {
    const color = Color.fromCssColorString(DARK[kind]);
    for (const line of geo.coordinates) {
      if (line.length < 2) continue;
      // One material per line: the collection destroys each line's
      // material, so a shared one would be destroyed twice.
      lines.add({
        positions: Cartesian3.fromDegreesArrayHeights(flatten(line, 600)),
        width,
        material: Material.fromType('Color', { color }),
      });
      kinds.push(kind);
    }
  };
  addLines(mesh(topo, countries, (a, b) => a !== b) as unknown as GeoJSON.MultiLineString, 'border', 1);
  addLines(mesh(topo, countries, (a, b) => a === b) as unknown as GeoJSON.MultiLineString, 'coast', 1);
  // Graticule every 30 degrees.
  const grid: Position[][] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const meridian: Position[] = [];
    for (let lat = -80; lat <= 80; lat += 5) meridian.push([lon, lat]);
    grid.push(meridian);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const parallel: Position[] = [];
    for (let lon = -180; lon <= 180; lon += 5) parallel.push([lon, lat]);
    grid.push(parallel);
  }
  addLines({ type: 'MultiLineString', coordinates: grid }, 'graticule', 1);
  scene.primitives.add(lines);

  let landColor = Color.fromCssColorString(DARK.land);
  let visible = true;
  let alpha = 1;
  // The 110m coastline and borders are coarse: right from orbit, but they
  // cut across bays and cities once the street tiles have faded in.
  const apply = () => {
    land.show = visible && alpha > 0.01;
    lines.show = visible && alpha > 0.15;
  };
  return {
    setFade(next) {
      alpha = next;
      landMaterial.uniforms.color = landColor.withAlpha(next);
      apply();
    },
    setVisible(next) {
      visible = next;
      apply();
    },
    setPalette(p) {
      Object.assign(DARK, p);
      landColor = Color.fromCssColorString(DARK.land);
      landMaterial.uniforms.color = landColor.withAlpha(alpha);
      const colors = {
        border: Color.fromCssColorString(DARK.border),
        coast: Color.fromCssColorString(DARK.coast),
        graticule: Color.fromCssColorString(DARK.graticule),
      };
      for (let i = 0; i < lines.length; i++) {
        const l = lines.get(i);
        l.material.uniforms.color = colors[kinds[i]];
      }
    },
    destroy() {
      // The scene may already be torn down (it destroys its primitives
      // itself), so only remove what is still alive.
      if (scene.isDestroyed()) return;
      for (const p of [land, lines]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
