// Infrastructure: power plants (WRI Global Power Plant Database, bundled)
// and submarine cables with landing points (TeleGeography, fetched onto
// this server by the worker).

import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from '@cesium/core';
import {
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  PointPrimitiveCollection,
  PolylineCollection,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

export interface InfraFilters {
  nuclear: boolean;
  power: boolean;
  cables: boolean;
}

export const DEFAULT_INFRA: InfraFilters = { nuclear: false, power: false, cables: false };

export const FUEL_COLOR: Record<string, string> = {
  Nuclear: '#d6f04a',
  Coal: '#a08070',
  Gas: '#ff9447',
  Oil: '#b8505a',
  Hydro: '#3fa7ff',
  Wind: '#7fd1c7',
  Solar: '#f0c94a',
  Other: '#9aa7ba',
};

export type Plant = [string, string, string, number, number, number];

export interface InfraLayer {
  setFilters: (f: InfraFilters) => void;
  plants: () => Plant[];
  cable: (id: string) => { name: string; id: string } | null;
  destroy: () => void;
}

export function addInfraLayer(scene: Scene): InfraLayer {
  const nuclear = new PointPrimitiveCollection();
  const power = new PointPrimitiveCollection();
  const nuclearLabels = new LabelCollection({ scene });
  const cables = new PolylineCollection();
  const landings = new PointPrimitiveCollection();
  for (const p of [cables, landings, power, nuclear, nuclearLabels]) scene.primitives.add(p);
  for (const p of [nuclear, power, nuclearLabels, cables, landings]) p.show = false;
  let plantRows: Plant[] = [];
  const cableNames = new Map<string, string>();
  let cablesLoaded = false;
  let filters = DEFAULT_INFRA;
  const dark = Color.fromCssColorString('#05080e');

  void fetch('/data/power.json')
    .then((r) => r.json())
    .then((rows: Plant[]) => {
      plantRows = rows;
      rows.forEach(([name, , fuel, mw, lon, lat], i) => {
        const position = Cartesian3.fromDegrees(lon, lat, 1000);
        const color = Color.fromCssColorString(FUEL_COLOR[fuel] ?? FUEL_COLOR.Other);
        const size = Math.max(4, Math.min(11, 3 + Math.sqrt(mw) / 9));
        const target = fuel === 'Nuclear' ? nuclear : power;
        target.add({
          id: 'pp:' + i,
          position,
          pixelSize: size,
          color: color.withAlpha(0.9),
          outlineColor: dark,
          outlineWidth: 1,
          scaleByDistance: new NearFarScalar(2e5, 1.2, 1.2e7, 0.6),
          distanceDisplayCondition: new DistanceDisplayCondition(0, fuel === 'Nuclear' ? 2.0e7 : 4.0e6),
        });
        if (fuel === 'Nuclear') {
          nuclearLabels.add({
            position,
            text: name,
            font: '500 10.5px Inter, system-ui, sans-serif',
            fillColor: color,
            outlineColor: dark,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(8, 0),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 6.0e5),
          });
        }
      });
    })
    .catch(() => undefined);

  async function loadCables() {
    if (cablesLoaded) return;
    cablesLoaded = true;
    try {
      const r = await fetch('/api/layers/cables', { credentials: 'same-origin' });
      if (!r.ok) return;
      const body = (await r.json()) as {
        cables: GeoJSON.FeatureCollection;
        landings: GeoJSON.FeatureCollection;
      };
      for (const f of body.cables.features) {
        const p = (f.properties ?? {}) as { id?: string; name?: string; color?: string };
        const g = f.geometry;
        const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
        cableNames.set(p.id ?? '', p.name ?? p.id ?? 'Cable');
        const color = Color.fromCssColorString(p.color ?? '#7fd1c7').withAlpha(0.85);
        for (const line of lines) {
          if (line.length < 2) continue;
          cables.add({
            id: 'cable:' + (p.id ?? ''),
            positions: Cartesian3.fromDegreesArrayHeights(line.flatMap(([lon, lat]) => [lon, lat, 500])),
            width: 1.4,
            material: Material.fromType('Color', { color }),
          });
        }
      }
      for (const f of body.landings.features) {
        if (f.geometry.type !== 'Point') continue;
        const [lon, lat] = f.geometry.coordinates;
        landings.add({
          position: Cartesian3.fromDegrees(lon, lat, 600),
          pixelSize: 3.5,
          color: Color.fromCssColorString('#d4dae2'),
          outlineColor: dark,
          outlineWidth: 1,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 5.0e6),
        });
      }
    } catch {
      cablesLoaded = false;
    }
  }

  return {
    setFilters(f) {
      filters = f;
      nuclear.show = filters.nuclear || filters.power;
      nuclearLabels.show = nuclear.show;
      power.show = filters.power;
      cables.show = landings.show = filters.cables;
      if (filters.cables) void loadCables();
    },
    plants: () => plantRows,
    cable(id) {
      const name = cableNames.get(id);
      return name ? { id, name } : null;
    },
    destroy() {
      if (scene.isDestroyed()) return;
      for (const p of [cables, landings, power, nuclear, nuclearLabels]) {
        if (!p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
