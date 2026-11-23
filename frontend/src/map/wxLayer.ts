// Weather on the map: NWS storm-based warnings (polygons, in the NWS's
// own colours for the main types), SPC risk areas (filled in SPC's
// colours), tropical cyclones (GDACS: cone, track, wind swath), NASA
// GIBS cloud and precipitation imagery, and NOAA nowCOAST radar,
// lightning, water vapour and sea temperature (WMS, no key).

import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  DistanceDisplayCondition,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
  Rectangle,
} from '@cesium/core';
import {
  GeographicTilingScheme,
  ImageryLayer,
  LabelCollection,
  LabelStyle,
  Material,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolylineCollection,
  Primitive,
  type Scene,
  VerticalOrigin,
  WebMapServiceImageryProvider,
  WebMapTileServiceImageryProvider,
} from '@cesium/engine';

import type { FirePerimeter, OutlookArea, Storm, WxAlert } from '../lib/api';

export const FIRE_COLOR = '#ff6a2b';

export interface WeatherFilters {
  alerts: boolean;
  // Zone-based watches, warnings and advisories (NWS zone outlines).
  zones: boolean;
  outlook: boolean;
  // Tropical cyclones worldwide: cone, track and wind swath.
  storms: boolean;
  // Current US wildfire outlines (NIFC perimeters).
  fires: boolean;
  clouds: boolean;
  vapour: boolean;
  precip: boolean;
  radar: boolean;
  lightning: boolean;
  sst: boolean;
  // Animated wind (map/windLayer.ts) and air quality (map/airLayer.ts).
  wind: boolean;
  air: boolean;
}

export const DEFAULT_WEATHER: WeatherFilters = {
  alerts: true,
  zones: false,
  outlook: false,
  storms: true,
  fires: true,
  clouds: false,
  vapour: false,
  precip: false,
  radar: false,
  lightning: false,
  sst: false,
  wind: false,
  air: false,
};

// The weather layers that are imagery, each with its own opacity.
export type WxImagery = 'clouds' | 'vapour' | 'precip' | 'radar' | 'lightning' | 'sst';
export const WX_IMAGERY: WxImagery[] = ['clouds', 'vapour', 'precip', 'radar', 'lightning', 'sst'];
export type WxOpacity = Partial<Record<WxImagery, number>>;
export const DEFAULT_OPACITY: Record<WxImagery, number> = {
  clouds: 0.65,
  vapour: 0.6,
  precip: 0.8,
  radar: 0.75,
  lightning: 0.9,
  sst: 0.6,
};
// Imagery that covers land (the dark map's land shapes are made
// see-through while it's shown); sea temperature is drawn on the sea.
export const WX_OVER_LAND: WxImagery[] = ['clouds', 'vapour', 'precip', 'radar', 'lightning'];

export function opacityOf(o: WxOpacity | undefined, id: WxImagery): number {
  const v = o?.[id];
  return typeof v === 'number' && v >= 0.05 && v <= 1 ? v : DEFAULT_OPACITY[id];
}

// Storm colours by category (GDACS track labels), lightest to strongest.
const STORM_COLOR: Record<string, string> = {
  TD: '#6fb7ff',
  TS: '#36d1a0',
  HU: '#ff9447',
  H1: '#ffd34d',
  H2: '#ffa53d',
  H3: '#ff7a2e',
  H4: '#ff4b3a',
  H5: '#d43cff',
};
export function stormColor(category: string): string {
  return STORM_COLOR[category] ?? '#c9d4e3';
}

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

// NOAA nowCOAST (public domain): a WMS whose layers update every few
// minutes. `stamp` changes with each refresh so browsers and nginx don't
// keep old tiles.
const NOWCOAST = 'https://nowcoast.noaa.gov/geoserver/ows';
function nowcoast(layer: string, stamp: number, rectangle?: Rectangle, maximumLevel = 9): ImageryLayer {
  return new ImageryLayer(
    new WebMapServiceImageryProvider({
      url: NOWCOAST,
      layers: layer,
      parameters: { transparent: true, format: 'image/png', styles: '', t: String(stamp) },
      tilingScheme: new GeographicTilingScheme(),
      rectangle: rectangle ?? Rectangle.fromDegrees(-180, -90, 180, 90),
      tileWidth: 512,
      tileHeight: 512,
      maximumLevel,
      credit: 'NOAA nowCOAST',
    }),
  );
}

// Each imagery layer: how to make it and how often to refresh it.
const IMAGERY: Record<WxImagery, { every: number; make: (stamp: number) => ImageryLayer[] }> = {
  // Clouds: the latest geostationary scan, every 10 minutes.
  clouds: { every: 600_000, make: () => CLOUD_LAYERS.map((name) => gibs(name, cloudTime())) },
  vapour: { every: 600_000, make: (t) => [nowcoast('satellite:global_water_vapor_imagery_mosaic', t, undefined, 7)] },
  // Precipitation (IMERG, half-hourly, a few hours behind): hourly.
  precip: { every: 3_600_000, make: () => [gibs('IMERG_Precipitation_Rate_30min', 'default')] },
  // US radar mosaic (CONUS, Alaska, Hawaii, Puerto Rico, Guam): 5 minutes.
  radar: { every: 300_000, make: (t) => [nowcoast('weather_radar:base_reflectivity_mosaic', t, undefined, 10)] },
  lightning: { every: 300_000, make: (t) => [nowcoast('lightning_detection:ldn_lightning_strike_density', t)] },
  // Sea surface temperature: daily analysis, refreshed every 6 hours.
  sst: {
    every: 21_600_000,
    make: (t) => [nowcoast('sea_surface_temperature:global_sea_surface_temperature', t, undefined, 7)],
  },
};

export interface WxLayer {
  update: (
    alerts: WxAlert[],
    zoned: WxAlert[],
    outlook: OutlookArea[],
    storms: Storm[],
    fires: FirePerimeter[],
    f: WeatherFilters,
  ) => void;
  setImagery: (f: WeatherFilters, opacity?: WxOpacity) => void;
  setDepthDistance: (metres: number) => void;
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
  const points = new PointPrimitiveCollection();
  const labels = new LabelCollection();
  scene.primitives.add(lines);
  scene.primitives.add(points);
  scene.primitives.add(labels);
  // Each shown imagery layer, and the refresh slot it was made for.
  const shown = new Map<WxImagery, { layers: ImageryLayer[]; slot: number }>();
  let depth = Number.POSITIVE_INFINITY;

  const clear = () => {
    if (fill && scene.primitives.contains(fill)) scene.primitives.remove(fill);
    fill = null;
    lines.removeAll();
    points.removeAll();
    labels.removeAll();
  };

  return {
    update(alerts, zoned, outlook, storms, fires, f) {
      clear();
      const instances: GeometryInstance[] = [];
      const shape = (id: string, ring: number[][], color: Color, alpha: number, width: number, edge = 0.9) => {
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
          material: Material.fromType('Color', { color: color.withAlpha(edge) }),
        });
      };
      if (f.outlook) {
        // Today only on the map, lowest risk first so higher ones sit on top.
        for (const a of outlook.filter((o) => o.day === 1)) {
          const c = Color.fromCssColorString(a.fill || '#66a366');
          for (const ring of a.polygons) shape('spc:' + a.key, ring, c, a.level ? 0.22 : 0.1, 1);
        }
      }
      // Zone alerts under the storm warnings: lighter, thinner edges.
      if (f.zones) {
        for (const a of [...zoned].sort((x, y) => x.severity - y.severity)) {
          const c = Color.fromCssColorString(alertColor(a));
          for (const ring of a.polygons) shape('wx:' + a.key, ring, c, 0.12, 1);
        }
      }
      if (f.alerts) {
        for (const a of alerts) {
          const c = Color.fromCssColorString(alertColor(a));
          for (const ring of a.polygons) shape('wx:' + a.key, ring, c, 0.2, a.severity >= 3 ? 2 : 1.4);
        }
      }
      if (f.fires) {
        // Wildfire outlines: hot orange, paler once mostly contained.
        const c = Color.fromCssColorString(FIRE_COLOR);
        for (const fire of fires) {
          const id = 'fire:' + fire.id;
          const done = (fire.contained ?? 0) >= 90;
          for (const ring of fire.rings) shape(id, ring, c, done ? 0.12 : 0.3, done ? 1.2 : 2, done ? 0.55 : 0.95);
          labels.add({
            id,
            position: Cartesian3.fromDegrees(fire.lon, fire.lat, 1200),
            text: fire.name,
            font: '600 11px Inter, system-ui, sans-serif',
            fillColor: c,
            outlineColor: Color.BLACK.withAlpha(0.8),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.CENTER,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 600_000),
            disableDepthTestDistance: depth,
          });
        }
      }
      if (f.storms) {
        for (const st of storms) {
          const id = 'storm:' + st.id;
          // The wind swath so far (60, 90, 120 km/h), then the cone.
          for (const w of st.swath) {
            const c = Color.fromCssColorString(
              w.label.startsWith('120') ? '#ff4b3a' : w.label.startsWith('90') ? '#ff9447' : '#e3c04b',
            );
            for (const ring of w.rings) shape(id, ring, c, 0.1, 1, 0.35);
          }
          for (const ring of st.cone) shape(id, ring, Color.WHITE, 0.08, 1.2, 0.6);
          for (const seg of st.track) {
            const c = Color.fromCssColorString(stormColor(seg.category));
            lines.add({
              id,
              positions: Cartesian3.fromDegreesArrayHeights(seg.coords.flatMap(([x, y]) => [x, y, 1100])),
              width: seg.forecast ? 2 : 3,
              material: seg.forecast
                ? Material.fromType('PolylineDash', { color: c.withAlpha(0.95), dashLength: 14 })
                : Material.fromType('Color', { color: c.withAlpha(0.95) }),
            });
          }
          const [x, y] = st.position;
          const at = Cartesian3.fromDegrees(x, y, 1200);
          points.add({
            id,
            position: at,
            pixelSize: 12,
            color: Color.fromCssColorString(stormColor(st.category)),
            outlineColor: Color.BLACK.withAlpha(0.7),
            outlineWidth: 2,
            disableDepthTestDistance: depth,
          });
          labels.add({
            id,
            position: at,
            text: st.name.replace(/-\d+$/, ''),
            font: '600 12px Inter, system-ui, sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK.withAlpha(0.8),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -10),
            disableDepthTestDistance: depth,
          });
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
    setImagery(f, opacity) {
      const layers = imagery();
      for (const id of WX_IMAGERY) {
        const spec = IMAGERY[id];
        const slot = f[id] ? Math.floor(Date.now() / spec.every) : 0;
        const have = shown.get(id);
        if ((have?.slot ?? 0) !== slot) {
          for (const l of have?.layers ?? []) layers.remove(l);
          shown.delete(id);
          if (slot) {
            const made = spec.make(slot);
            for (const l of made) layers.add(l);
            shown.set(id, { layers: made, slot });
          }
        }
        const a = opacityOf(opacity, id);
        for (const l of shown.get(id)?.layers ?? []) l.alpha = a;
      }
    },
    forget() {
      shown.clear();
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = metres;
      for (let i = 0; i < labels.length; i++) labels.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      clear();
      if (scene.isDestroyed()) return;
      for (const c of [lines, points, labels]) if (scene.primitives.contains(c)) scene.primitives.remove(c);
    },
  };
}
