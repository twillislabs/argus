import '@cesium/engine/Source/Widget/CesiumWidget.css';

import {
  Cartesian2,
  Cartesian3,
  Color,
  Math as CesiumMath,
  Matrix4,
  BoundingSphere,
  HeadingPitchRange,
  NearFarScalar,
  Rectangle,
} from '@cesium/core';
// The core engine only: the full `cesium` package also bundles Knockout
// for its Viewer widgets, which needs `eval` and breaks our strict CSP.
import {
  CallbackProperty,
  type Cesium3DTileset,
  CesiumWidget,
  createGooglePhotorealistic3DTileset,
  Google2DImageryProvider,
  Credit,
  GeographicTilingScheme,
  ImageryLayer,
  type ImageryProvider,
  Ion,
  LabelStyle,
  type PointPrimitive,
  PointPrimitiveCollection,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  WebMapTileServiceImageryProvider,
} from '@cesium/engine';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { Aircraft, Bbox, EventItem, Home, MapConfig } from '../lib/api';
import { SEVERITY_COLOR } from '../lib/format';
import { type AircraftCamera, type CameraMode, createAircraftCamera } from './aircraftCamera';
import { addAircraftLayer, type AircraftLayer } from './aircraftLayer';
import { addDarkMap, DARK, type DarkMap } from './darkMap';
import { addOverlays, type Overlays, type ReferenceLayers } from './overlays';

// No Cesium ion: every tile comes from a source we configure.
Ion.defaultAccessToken = '';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

export const HOME_HEIGHT_M = 2_500_000;
const WORLD_VIEW = { lon: -30, lat: 25, height: 18_000_000 };
const EARTH_RADIUS_M = 6_378_137;

// Markers sit on (or just above) the surface and the dark map's land and
// border shapes, so with normal depth testing they get cut by them,
// especially in 2D and near the horizon. Turn depth testing off out to the
// horizon distance: everything nearer is on the visible side of the
// globe, and everything on the far side stays hidden by it.
function depthDistance(v: CesiumWidget): number {
  if (v.scene.mode !== SceneMode.SCENE3D) return Number.POSITIVE_INFINITY;
  const h = Math.max(0, v.camera.positionCartographic.height);
  return Math.sqrt(h * h + 2 * EARTH_RADIUS_M * h);
}

// Argus Dark shows vector countries above FADE_TOP and street tiles below
// FADE_BOTTOM, cross-fading in between.
const FADE_TOP = 3_200_000;
const FADE_BOTTOM = 1_200_000;
const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type Basemap = 'dark' | 'satellite' | 'hybrid' | 'photo3d';
export type Imagery = MapConfig['imagery'];

export const BASEMAPS: { id: Basemap; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
];

function blueMarble() {
  return new WebMapTileServiceImageryProvider({
    url:
      GIBS +
      'BlueMarble_ShadedRelief_Bathymetry/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg',
    layer: 'BlueMarble_ShadedRelief_Bathymetry',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: '500m',
    tileWidth: 512,
    tileHeight: 512,
    maximumLevel: 7,
    // GIBS EPSG:4326 tile matrices use 512 px tiles anchored at (-180, 90)
    // that span 288 degrees at level 0, so the grid runs past the world's
    // edges: 2 x 1 tiles covering -180..396 E and -198..90 N.
    tilingScheme: new GeographicTilingScheme({
      rectangle: Rectangle.fromDegrees(-180, -198, 396, 90),
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1,
    }),
    credit: new Credit('NASA GIBS'),
  });
}

function esri(service: string, maximumLevel: number, credit?: string) {
  return new UrlTemplateImageryProvider({
    url: ESRI + service + '/MapServer/tile/{z}/{y}/{x}',
    maximumLevel,
    credit: credit ? new Credit(credit) : undefined,
  });
}

// Esri's grey is neutral and Argus Dark is slightly blue. A faint blue
// wash over it makes the two meet without a visible edge around the
// self-hosted street map region.
const TINT_ALPHA = 0.3;
function tintLayer(): ImageryLayer {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#13233a';
    ctx.fillRect(0, 0, 1, 1);
  }
  const layer = new ImageryLayer(
    new SingleTileImageryProvider({ url: c.toDataURL(), tileWidth: 1, tileHeight: 1 }),
  );
  (layer as ImageryLayer & { argusAlpha?: number }).argusAlpha = TINT_ALPHA;
  return layer;
}

// Google's photorealistic 3D cities, when an admin turned them on.
export const PHOTO_3D: { id: Basemap; label: string } = { id: 'photo3d', label: '3D' };

// Cesium's typings disagree with themselves on getTileCredits; the
// provider is a normal ImageryProvider at runtime.
function google2d(options: Parameters<typeof Google2DImageryProvider.fromUrl>[0]) {
  return Google2DImageryProvider.fromUrl(options) as unknown as Promise<ImageryProvider>;
}

// Google Map Tiles (the admin's key): satellite, plus a roads and labels
// overlay for Hybrid.
function googleLayers(id: Basemap, key: string): ImageryLayer[] {
  const base = [
    new ImageryLayer(blueMarble()),
    ImageryLayer.fromProviderAsync(google2d({ key, mapType: 'satellite' })),
  ];
  if (id !== 'hybrid') return base;
  return [
    ...base,
    ImageryLayer.fromProviderAsync(google2d({ key, overlayLayerType: 'layerRoadmap' })),
  ];
}

// Hosted Esri tiles for street detail and imagery (no key needed for light
// use), or Google's for Satellite and Hybrid when an admin set a key.
function basemapLayers(id: Basemap, imagery: Imagery | null): ImageryLayer[] {
  if (id !== 'dark' && imagery?.provider === 'google' && imagery.google_key) {
    return googleLayers(id, imagery.google_key);
  }
  if (id === 'dark') {
    // Esri's dark grey is lighter and flatter than Argus Dark; darken it
    // and add contrast so zooming in keeps the same near-black look.
    return [
      new ImageryLayer(esri('Canvas/World_Dark_Gray_Base', 16, 'Esri, HERE, Garmin, © OpenStreetMap'), {
        brightness: 0.62,
        contrast: 1.35,
        gamma: 1.1,
      }),
      tintLayer(),
      new ImageryLayer(esri('Canvas/World_Dark_Gray_Reference', 16), { brightness: 1.15 }),
    ];
  }
  const esriImagery = new ImageryLayer(
    esri('World_Imagery', 19, 'Esri, Maxar, Earthstar Geographics'),
  );
  const base = [new ImageryLayer(blueMarble()), esriImagery];
  if (id === 'satellite') return base;
  return [
    ...base,
    new ImageryLayer(esri('Reference/World_Transportation', 19)),
    new ImageryLayer(esri('Reference/World_Boundaries_and_Places', 19)),
  ];
}

// Bump when streetmap/styles/argus-dark.json changes: tiles are cached by
// nginx and browsers, and this makes them redraw.
const STREET_STYLE_VERSION = 2;

// The self-hosted street map, when a region is installed (make streetmap).
// Resolves to its bounds in degrees, or null to use Esri everywhere.
let localStreets: Promise<number[] | null> | null = null;
function localStreetBounds(): Promise<number[] | null> {
  localStreets ??= fetch('/tiles/data/protomaps.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { bounds?: number[] } | null) =>
      j && Array.isArray(j.bounds) && j.bounds.length === 4 ? j.bounds : null,
    )
    .catch(() => null);
  return localStreets;
}

function localStreetLayer(bounds: number[]): ImageryLayer {
  const [w, s, e, n] = bounds;
  return new ImageryLayer(
    new UrlTemplateImageryProvider({
      // 256 px tiles drawn at 2x, so labels stay sharp on any screen.
      url: '/tiles/styles/argus-dark/256/{z}/{x}/{y}@2x.png?v=' + STREET_STYLE_VERSION,
      rectangle: Rectangle.fromDegrees(w, s, e, n),
      maximumLevel: 19,
      credit: new Credit('© OpenStreetMap contributors'),
    }),
  );
}

export interface GlobeHandle {
  flyHome: () => void;
  flyWorld: () => void;
  flyTo: (lat: number, lon: number, height?: number) => void;
  setMode: (mode: '3d' | '2d') => void;
  view: () => { bbox: Bbox | null; height: number } | null;
  // Camera presets around the point at the centre of the screen.
  topDown: () => void;
  oblique: () => void;
  northUp: () => void;
  // Return to where the camera was before the last fly (home, world,
  // search, event). Returns false when there's nowhere to go back to.
  back: () => boolean;
  // The camera as a share-link string, and applying one.
  cameraString: () => string | null;
  applyCamera: (s: string) => boolean;
}

export interface SavedCamera {
  lon: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
}

function saveCamera(v: CesiumWidget): SavedCamera {
  const c = v.camera.positionCartographic;
  return {
    lon: CesiumMath.toDegrees(c.longitude),
    lat: CesiumMath.toDegrees(c.latitude),
    height: c.height,
    heading: v.camera.heading,
    pitch: v.camera.pitch,
  };
}

// The point on the globe at the centre of the screen.
function centreTarget(v: CesiumWidget): Cartesian3 | undefined {
  const canvas = v.scene.canvas;
  const centre = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  return v.camera.pickEllipsoid(centre, v.scene.globe.ellipsoid);
}

function reorient(v: CesiumWidget, heading: number | null, pitch: number | null) {
  if (v.scene.mode !== SceneMode.SCENE3D) return;
  const target = centreTarget(v);
  if (!target) return;
  const range = Cartesian3.distance(v.camera.positionWC, target);
  v.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(
      heading ?? v.camera.heading,
      pitch ?? v.camera.pitch,
      range,
    ),
    duration: reduceMotion ? 0 : 0.8,
  });
}

// The visible area, or null when the view includes the sky or a pole.
function viewBbox(v: CesiumWidget): Bbox | null {
  const rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
  if (!rect) return null;
  const d = CesiumMath.toDegrees;
  return [d(rect.west), d(rect.south), d(rect.east), d(rect.north)];
}

interface Props {
  basemap: Basemap;
  imagery: Imagery | null;
  reference: ReferenceLayers;
  home: Home | null;
  events: EventItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFocus?: (id: string) => void;
  aircraft: Aircraft[];
  selectedHex: string | null;
  trail: number[][] | null;
  camera: CameraMode;
  onView?: (bbox: Bbox | null, height: number, passive?: boolean) => void;
  // How many steps Back can go.
  onHistory?: (depth: number) => void;
}

const Globe = forwardRef<GlobeHandle, Props>(function Globe(
  {
    basemap,
    imagery,
    reference,
    home,
    events,
    selectedId,
    onSelect,
    onFocus,
    aircraft,
    selectedHex,
    trail,
    camera,
    onView,
    onHistory,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<CesiumWidget | null>(null);
  const points = useRef<PointPrimitiveCollection | null>(null);
  const rings = useRef<PointPrimitiveCollection | null>(null);
  const dark = useRef<DarkMap | null>(null);
  const air = useRef<AircraftLayer | null>(null);
  const tracker = useRef<AircraftCamera | null>(null);
  const photo3d = useRef<Cesium3DTileset | null>(null);
  const overlays = useRef<Overlays | null>(null);
  const history = useRef<SavedCamera[]>([]);
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const tiles = useRef<ImageryLayer[]>([]);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  useEffect(() => {
    if (!container.current) return;
    const v = new CesiumWidget(container.current, { baseLayer: false });
    const scene = v.scene;
    scene.backgroundColor = Color.fromCssColorString(DARK.background);
    scene.globe.baseColor = Color.fromCssColorString(DARK.ocean);
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;

    const collection = new PointPrimitiveCollection();
    const ringCollection = new PointPrimitiveCollection();
    scene.primitives.add(ringCollection);
    scene.primitives.add(collection);
    points.current = collection;
    rings.current = ringCollection;
    air.current = addAircraftLayer(scene);
    const aircraftCamera = createAircraftCamera(v, () => air.current);
    tracker.current = aircraftCamera;
    // While the camera rides along, report the view every few seconds so
    // civil traffic keeps loading around the aircraft.
    let lastViewReport = 0;
    const removeTracking = scene.preRender.addEventListener(() => {
      aircraftCamera.tick();
      const now = performance.now();
      if (!Matrix4.equals(v.camera.transform, Matrix4.IDENTITY) && now - lastViewReport > 5000) {
        lastViewReport = now;
        onViewRef.current?.(viewBbox(v), v.camera.positionCartographic.height, true);
      }
    });

    let disposed = false;
    void addDarkMap(scene).then((m) => {
      if (disposed) {
        m.destroy();
        return;
      }
      dark.current = m;
      applyFade();
    });
    void addOverlays(scene).then((o) => {
      if (disposed) {
        o.destroy();
        return;
      }
      overlays.current = o;
      o.setLayers(referenceRef.current);
      o.setImagery(basemapRef.current === 'dark' ? 'dark' : basemapRef.current === 'hybrid' ? 'hybrid' : 'satellite');
      depthNow = -1;
      applyDepth();
    });

    // Cross-fade vector countries and street tiles with camera height.
    function applyFade() {
      const h = v.camera.positionCartographic.height;
      const t = Math.min(1, Math.max(0, (FADE_TOP - h) / (FADE_TOP - FADE_BOTTOM)));
      const isDark = basemapRef.current === 'dark';
      dark.current?.setVisible(isDark);
      if (isDark) dark.current?.setFade(1 - t);
      for (const layer of tiles.current) {
        const base = (layer as ImageryLayer & { argusAlpha?: number }).argusAlpha ?? 1;
        layer.alpha = (isDark ? t : 1) * base;
      }
    }
    let depthNow = -1;
    function applyDepth() {
      const d = depthDistance(v);
      if (Math.abs(d - depthNow) < Math.max(1, depthNow * 0.01)) return;
      depthNow = d;
      for (const c of [collection, ringCollection]) {
        for (let i = 0; i < c.length; i++) c.get(i).disableDepthTestDistance = d;
      }
      air.current?.setDepthDistance(d);
      overlays.current?.setDepthDistance(d);
    }
    (v as unknown as { applyDepth: () => void }).applyDepth = () => {
      depthNow = -1;
      applyDepth();
    };
    v.camera.percentageChanged = 0.02;
    const removeCamera = v.camera.changed.addEventListener(() => {
      applyFade();
      applyDepth();
    });
    const removeMorph = scene.morphComplete.addEventListener(() => {
      depthNow = -1;
      applyDepth();
    });
    const removeMoveEnd = v.camera.moveEnd.addEventListener(() => {
      onViewRef.current?.(viewBbox(v), v.camera.positionCartographic.height);
    });
    (v as unknown as { applyFade: () => void }).applyFade = applyFade;

    // Pulsing rings on high-severity events.
    const removePulse = scene.preRender.addEventListener(() => {
      const now = performance.now() / 1000;
      for (let i = 0; i < ringCollection.length; i++) {
        const ring = ringCollection.get(i) as PointPrimitive & { _phase?: number; _base?: number };
        const phase = reduceMotion ? 0.5 : ((now + (ring._phase ?? 0)) % 2.4) / 2.4;
        ring.pixelSize = (ring._base ?? 10) + phase * 26;
        ring.outlineColor = ring.outlineColor.withAlpha((1 - phase) * 0.75);
      }
    });

    const handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = scene.pick(e.position);
      const id = picked && typeof picked.id === 'string' ? picked.id : null;
      onSelectRef.current(id);
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = scene.pick(e.position);
      if (picked && typeof picked.id === 'string') onFocusRef.current?.(picked.id);
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      const picked = scene.pick(e.endPosition);
      scene.canvas.style.cursor = picked && typeof picked.id === 'string' ? 'pointer' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);

    viewer.current = v;
    // Test hook for automated screenshots: localStorage argusDebug=1.
    let debug = false;
    try {
      debug = localStorage.getItem('argusDebug') === '1';
    } catch {
      // Storage blocked: no hook.
    }
    if (debug) {
      (window as unknown as { argusGlobe: CesiumWidget }).argusGlobe = v;
    }
    return () => {
      disposed = true;
      // Each step guarded: a failure here must not break navigation.
      const steps: [string, () => void][] = [
        ['camera listener', removeCamera],
        ['move listener', removeMoveEnd],
        ['morph listener', removeMorph],
        ['tracking', removeTracking],
        ['aircraft', () => air.current?.destroy()],
        ['overlays', () => overlays.current?.destroy()],
        ['pulse listener', removePulse],
        ['input handler', () => handler.destroy()],
        ['widget', () => v.destroy()],
      ];
      for (const [name, step] of steps) {
        try {
          step();
        } catch (err) {
          console.error('Globe cleanup failed at ' + name, err);
        }
      }
      dark.current = null;
      overlays.current = null;
      air.current = null;
      tracker.current = null;
      viewer.current = null;
      points.current = null;
      rings.current = null;
    };
  }, []);

  // Base map: swap imagery layers; atmosphere only for imagery maps.
  const imageryKey = imagery ? [imagery.provider, imagery.google_key, imagery.google_3d].join('|') : '';
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let stale = false;
    v.scene.imageryLayers.removeAll();
    tiles.current = basemapLayers(basemap, imagery);
    // Photorealistic 3D replaces the globe surface with Google's tiles.
    if (photo3d.current) {
      if (!v.isDestroyed() && v.scene.primitives.contains(photo3d.current)) {
        v.scene.primitives.remove(photo3d.current);
      }
      photo3d.current = null;
    }
    const wants3d = basemap === 'photo3d' && Boolean(imagery?.google_3d && imagery.google_key);
    v.scene.globe.show = !wants3d;
    if (wants3d && imagery?.google_key) {
      createGooglePhotorealistic3DTileset({ key: imagery.google_key })
        .then((tileset) => {
          if (stale || v.isDestroyed()) {
            tileset.destroy();
            return;
          }
          photo3d.current = tileset;
          v.scene.primitives.add(tileset);
        })
        .catch((err) => {
          console.error('Google 3D tiles failed to load', err);
          if (!stale && !v.isDestroyed()) v.scene.globe.show = true;
        });
    }
    for (const layer of tiles.current) v.scene.imageryLayers.add(layer);
    // Inside the installed region, the self-hosted street map draws over
    // Esri; outside it, Esri shows as before.
    if (basemap === 'dark') {
      void localStreetBounds().then((bounds) => {
        if (stale || !bounds || v.isDestroyed()) return;
        const layer = localStreetLayer(bounds);
        v.scene.imageryLayers.add(layer);
        tiles.current = [...tiles.current, layer];
        (v as unknown as { applyFade?: () => void }).applyFade?.();
      });
    }
    const isDark = basemap === 'dark';
    overlays.current?.setImagery(isDark ? 'dark' : basemap === 'hybrid' ? 'hybrid' : 'satellite');
    v.scene.globe.showGroundAtmosphere = !isDark;
    const sky = v.scene.skyAtmosphere;
    if (sky) {
      // Dark map: a thin, dim blue rim instead of the bright daylight sky.
      sky.show = true;
      sky.hueShift = isDark ? -0.04 : 0;
      sky.saturationShift = isDark ? -0.35 : 0;
      sky.brightnessShift = isDark ? -0.62 : 0;
    }
    (v as unknown as { applyFade?: () => void }).applyFade?.();
    return () => {
      stale = true;
    };
    // imageryKey stands for imagery's contents.
  }, [basemap, imageryKey]);

  // Event markers: colour and size by severity, larger when selected.
  useEffect(() => {
    const collection = points.current;
    const ringCollection = rings.current;
    if (!collection || !ringCollection) return;
    collection.removeAll();
    ringCollection.removeAll();
    const outline = Color.fromCssColorString('#05080e');
    const scale = new NearFarScalar(2.0e5, 1.6, 2.0e7, 0.8);
    events.forEach((e, i) => {
      const selected = e.id === selectedId;
      const color = Color.fromCssColorString(SEVERITY_COLOR[e.severity] ?? '#7d93ad');
      const position = Cartesian3.fromDegrees(e.lon, e.lat);
      const size = 5 + e.severity * 2;
      collection.add({
        id: e.id,
        position,
        pixelSize: size + (selected ? 6 : 0),
        color: e.status === 'candidate' ? color.withAlpha(0.45) : color,
        outlineColor: selected ? Color.WHITE : outline,
        outlineWidth: selected ? 2.5 : 1.2,
        scaleByDistance: scale,
      });
      if (e.severity >= 3 && e.status === 'active') {
        const ring = ringCollection.add({
          position,
          pixelSize: size,
          color: Color.TRANSPARENT,
          outlineColor: color,
          outlineWidth: 1.5,
          scaleByDistance: scale,
        }) as PointPrimitive & { _phase?: number; _base?: number };
        ring._phase = (i * 0.37) % 2.4;
        ring._base = size;
      }
    });
    (viewer.current as unknown as { applyDepth?: () => void } | null)?.applyDepth?.();
  }, [events, selectedId]);

  // Aircraft: update in place; the tracker moves the selected one between
  // reports and drives the camera views.
  useEffect(() => {
    air.current?.update(aircraft, selectedHex);
    (viewer.current as unknown as { applyDepth?: () => void } | null)?.applyDepth?.();
    tracker.current?.setTarget(aircraft.find((x) => x.hex === selectedHex) ?? null);
  }, [aircraft, selectedHex]);

  useEffect(() => {
    tracker.current?.setMode(camera);
  }, [camera]);

  const referenceKey = [reference.borders, reference.states, reference.labels, reference.airports].join('');
  useEffect(() => {
    overlays.current?.setLayers(referenceRef.current);
  }, [referenceKey]);

  useEffect(() => {
    air.current?.setTrail(trail);
  }, [trail]);

  // Home marker and start view. Keyed on the values, not the object, so
  // reloading preferences doesn't yank the camera back home.
  const homeKey = home ? [home.lat, home.lon, home.name].join('|') : '';
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.entities.removeById('home');
    if (home) {
      v.entities.add({
        id: 'home',
        position: Cartesian3.fromDegrees(home.lon, home.lat),
        point: {
          pixelSize: 9,
          color: Color.fromCssColorString('#5b9bff'),
          outlineColor: Color.fromCssColorString('#0b0e13'),
          outlineWidth: 2,
          disableDepthTestDistance: new CallbackProperty(() => depthDistance(v), false),
        },
        label: {
          text: /^home$/i.test(home.name.trim()) ? 'HOME' : 'HOME · ' + home.name.toUpperCase(),
          font: '500 12px "JetBrains Mono", monospace',
          fillColor: Color.fromCssColorString('#8fb8ff'),
          outlineColor: Color.fromCssColorString('#05080e'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: new CallbackProperty(() => depthDistance(v), false),
          pixelOffset: new Cartesian2(0, -10),
        },
      });
    }
    const target = home ? { lon: home.lon, lat: home.lat, height: HOME_HEIGHT_M } : WORLD_VIEW;
    v.camera.setView({
      destination: Cartesian3.fromDegrees(target.lon, target.lat, target.height),
    });
  }, [homeKey]);

  useImperativeHandle(
    ref,
    () => {
      // Remember where the camera was, for Back.
      function remember() {
        const v = viewer.current;
        if (!v) return;
        history.current = [...history.current, saveCamera(v)].slice(-10);
        onHistoryRef.current?.(history.current.length);
      }
      return {
        flyHome() {
          remember();
          tracker.current?.release();
          const t = home ? { lon: home.lon, lat: home.lat, height: HOME_HEIGHT_M } : WORLD_VIEW;
          viewer.current?.camera.flyTo({
            destination: Cartesian3.fromDegrees(t.lon, t.lat, t.height),
            duration: 1.6,
          });
        },
        flyWorld() {
          remember();
          tracker.current?.release();
          // Centre the world view on home's longitude when there is one.
          const lon = home ? home.lon : WORLD_VIEW.lon;
          viewer.current?.camera.flyTo({
            destination: Cartesian3.fromDegrees(lon, 20, WORLD_VIEW.height),
            duration: 1.6,
          });
        },
        flyTo(lat, lon, height = 1_500_000) {
          remember();
          tracker.current?.release();
          viewer.current?.camera.flyTo({
            destination: Cartesian3.fromDegrees(lon, lat, height),
            duration: 1.4,
          });
        },
        view() {
          const v = viewer.current;
          if (!v) return null;
          return { bbox: viewBbox(v), height: v.camera.positionCartographic.height };
        },
        setMode(mode) {
          const v = viewer.current;
          if (!v) return;
          if (mode === '2d' && v.scene.mode !== SceneMode.SCENE2D) v.scene.morphTo2D(1.2);
          if (mode === '3d' && v.scene.mode !== SceneMode.SCENE3D) v.scene.morphTo3D(1.2);
        },
        topDown() {
          const v = viewer.current;
          if (!v) return;
          tracker.current?.release();
          // Exactly -90 degrees is degenerate for an orbit offset.
          reorient(v, null, -CesiumMath.PI_OVER_TWO + 0.001);
        },
        oblique() {
          const v = viewer.current;
          if (!v) return;
          tracker.current?.release();
          reorient(v, null, CesiumMath.toRadians(-35));
        },
        northUp() {
          const v = viewer.current;
          if (!v) return;
          tracker.current?.release();
          if (v.scene.mode === SceneMode.SCENE3D) reorient(v, 0, null);
          else v.camera.setView({ orientation: { heading: 0, pitch: v.camera.pitch, roll: 0 } });
        },
        back() {
          const v = viewer.current;
          const last = history.current[history.current.length - 1];
          if (!v || !last) return false;
          history.current = history.current.slice(0, -1);
          onHistoryRef.current?.(history.current.length);
          tracker.current?.release();
          v.camera.flyTo({
            destination: Cartesian3.fromDegrees(last.lon, last.lat, last.height),
            orientation: { heading: last.heading, pitch: last.pitch, roll: 0 },
            duration: reduceMotion ? 0 : 1.4,
          });
          return true;
        },
        cameraString() {
          const v = viewer.current;
          if (!v) return null;
          const c = saveCamera(v);
          return [
            c.lon.toFixed(5),
            c.lat.toFixed(5),
            Math.round(c.height),
            CesiumMath.toDegrees(c.heading).toFixed(1),
            CesiumMath.toDegrees(c.pitch).toFixed(1),
          ].join(',');
        },
        applyCamera(text) {
          const v = viewer.current;
          const parts = text.split(',').map(Number);
          if (!v || parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return false;
          const [lon, lat, height, heading = 0, pitch = -90] = parts;
          if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || height < 1 || height > 5e7) return false;
          v.camera.setView({
            destination: Cartesian3.fromDegrees(lon, lat, height),
            orientation: {
              heading: CesiumMath.toRadians(heading),
              pitch: CesiumMath.toRadians(Math.max(-90, Math.min(0, pitch))),
              roll: 0,
            },
          });
          return true;
        },
      };
    },
    [home],
  );

  return <div ref={container} className="globe" aria-label="Globe" />;
});

export default Globe;
