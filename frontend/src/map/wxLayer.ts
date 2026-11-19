// Weather on the map: NWS storm-based warnings (polygons, in the NWS's
// own colours for the main types), SPC risk areas (filled in SPC's
// colours), and NASA GIBS cloud and precipitation imagery.

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
  Rectangle,
} from '@cesium/core';
import {
  GeographicTilingScheme,
  ImageryLayer,
  Material,
  PerInstanceColorAppearance,
  PolylineCollection,
  Primitive,
  type Scene,
  WebMapTileServiceImageryProvider,
} from '@cesium/engine';

import type { OutlookArea, WxAlert } from '../lib/api';

export interface WeatherFilters {
  alerts: boolean;
  outlook: boolean;
  clouds: boolean;
  precip: boolean;
}

export const DEFAULT_WEATHER: WeatherFilters = { alerts: true, outlook: false, clouds: false, precip: false };

// The NWS's colours for the warnings people look for; others by severity.
const EVENT_COLOR: Record<string, string> = {
  'Tornado Warning': '#ff2d3d',
  'Tornado Watch': '#f0e050',
  'Severe Thunderstorm Warning': '#ffa500',
  'Severe Thunderstorm Watch': '#db7093',
  'Flash Flood Warning': '#c0392b',
  'Flood Warning': '#2ecc71',
  'Special Marine Warning': '#ffa500',
  'Winter Storm Warning': '#ff69b4',
  'Blizzard Warning': '#ff4500',
  'Hurricane Warning': '#dc143c',
  'Tropical Storm Warning': '#b22222',
  'Extreme Wind Warning': '#ff8c00',
  'Dust Storm Warning': '#ffe4c4',
};
const SEVERITY_COLOR = ['#7d93ad', '#8cc8ff', '#e3c04b', '#ff9447', '#ff2d3d'];

export function alertColor(a: Pick<WxAlert, 'event' | 'severity'>): string {
  return EVENT_COLOR[a.event] ?? SEVERITY_COLOR[Math.max(0, Math.min(4, a.severity))];
}

// Cesium fills {Time}, {TileMatrix}, {TileRow} and {TileCol}; the layer
// name goes into the URL itself.
const GIBS =
  'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/LAYER/default/{Time}/2km/{TileMatrix}/{TileRow}/{TileCol}.png';
const CLOUD_LAYERS = [
  'GOES-East_ABI_Band13_Clean_Infrared',
  'GOES-West_ABI_Band13_Clean_Infrared',
  'Himawari_AHI_Band13_Clean_Infrared',
];

// The latest geostationary scan GIBS is likely to have: 10-minute steps,
// about 40 minutes behind.
function cloudTime(): string {
  const t = new Date(Math.floor((Date.now() - 40 * 60_000) / 600_000) * 600_000);
  return t.toISOString().slice(0, 17) + '00Z';
}

function gibs(layer: string, time: string): ImageryLayer {
  return new ImageryLayer(
    new WebMapTileServiceImageryProvider({
      url: GIBS.replace('LAYER', layer),
      layer,
      style: 'default',
      tileMatrixSetID: '2km',
      format: 'image/png',
      // GIBS's 2 km matrix: 512 px tiles at 0.5625°/px, so level 0 is two
      // tiles over -180..396° by one over 90..-198°. Only the globe is
      // requested.
      tilingScheme: new GeographicTilingScheme({
        rectangle: Rectangle.fromDegrees(-180, -198, 396, 90),
        numberOfLevelZeroTilesX: 2,
        numberOfLevelZeroTilesY: 1,
      }),
      rectangle: Rectangle.fromDegrees(-180, -90, 180, 90),
      tileWidth: 512,
      tileHeight: 512,
      maximumLevel: 5,
      dimensions: { Time: time },
      credit: 'NASA GIBS',
    }),
    { alpha: 0.65 },
  );
}

export interface WxLayer {
  update: (alerts: WxAlert[], outlook: OutlookArea[], f: WeatherFilters) => void;
  setImagery: (f: WeatherFilters) => void;
  // The base map was rebuilt (its imagery layers were all removed).
  forget: () => void;
  destroy: () => void;
}

export function addWxLayer(
  scene: Scene,
  imagery: () => { add: (l: ImageryLayer) => void; remove: (l: ImageryLayer) => void },
): WxLayer {
  let fill: Primitive | null = null;
  const lines = new PolylineCollection();
  scene.primitives.add(lines);
  let clouds: ImageryLayer[] = [];
  let precip: ImageryLayer | null = null;
  let cloudsAt = '';
  let precipAt = 0;

  const clear = () => {
    if (fill && scene.primitives.contains(fill)) scene.primitives.remove(fill);
    fill = null;
    lines.removeAll();
  };

  return {
    update(alerts, outlook, f) {
      clear();
      const instances: GeometryInstance[] = [];
      const shape = (id: string, ring: number[][], color: Color, alpha: number, width: number) => {
        const positions = Cartesian3.fromDegreesArray(ring.slice(0, -1).flatMap(([x, y]) => [x, y]));
        if (positions.length < 3) return;
        instances.push(
          new GeometryInstance({
            id,
            geometry: new PolygonGeometry({
              polygonHierarchy: new PolygonHierarchy(positions),
              height: 700,
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(alpha)) },
          }),
        );
        lines.add({
          id,
          positions: Cartesian3.fromDegreesArrayHeights(ring.flatMap(([x, y]) => [x, y, 900])),
          width,
          material: Material.fromType('Color', { color: color.withAlpha(0.9) }),
        });
      };
      if (f.outlook) {
        // Today only on the map, lowest risk first so higher ones sit on top.
        for (const a of outlook.filter((o) => o.day === 1)) {
          const c = Color.fromCssColorString(a.fill || '#66a366');
          for (const ring of a.polygons) shape('spc:' + a.key, ring, c, a.level ? 0.22 : 0.1, 1);
        }
      }
      if (f.alerts) {
        for (const a of alerts) {
          const c = Color.fromCssColorString(alertColor(a));
          for (const ring of a.polygons) shape('wx:' + a.key, ring, c, 0.2, a.severity >= 3 ? 2 : 1.4);
        }
      }
      if (!instances.length) return;
      fill = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      });
      scene.primitives.add(fill);
    },
    setImagery(f) {
      const layers = imagery();
      // Clouds: refresh to the latest scan every 10 minutes.
      const at = f.clouds ? cloudTime() : '';
      if (at !== cloudsAt) {
        for (const l of clouds) layers.remove(l);
        clouds = at ? CLOUD_LAYERS.map((name) => gibs(name, at)) : [];
        for (const l of clouds) layers.add(l);
        cloudsAt = at;
      }
      // Precipitation (IMERG, half-hourly, a few hours behind): hourly.
      const hour = f.precip ? Math.floor(Date.now() / 3_600_000) : 0;
      if (hour !== precipAt) {
        if (precip) layers.remove(precip);
        precip = hour ? gibs('IMERG_Precipitation_Rate_30min', 'default') : null;
        if (precip) {
          precip.alpha = 0.8;
          layers.add(precip);
        }
        precipAt = hour;
      }
    },
    forget() {
      clouds = [];
      precip = null;
      cloudsAt = '';
      precipAt = 0;
    },
    destroy() {
      clear();
      if (!scene.isDestroyed() && scene.primitives.contains(lines)) scene.primitives.remove(lines);
    },
  };
}
