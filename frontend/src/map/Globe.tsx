import '@cesium/engine/Source/Widget/CesiumWidget.css';

import { Cartesian2, Cartesian3, Color, NearFarScalar, Rectangle } from '@cesium/core';
// The core engine only: the full `cesium` package also bundles Knockout
// for its Viewer widgets, which needs `eval` and breaks our strict CSP.
import {
  CesiumWidget,
  Credit,
  GeographicTilingScheme,
  ImageryLayer,
  Ion,
  LabelStyle,
  type PointPrimitive,
  PointPrimitiveCollection,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  WebMapTileServiceImageryProvider,
} from '@cesium/engine';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { EventItem, Home } from '../lib/api';
import { SEVERITY_COLOR } from '../lib/format';
import { addDarkMap, DARK, type DarkMap } from './darkMap';

// No Cesium ion: every tile comes from a source we configure.
Ion.defaultAccessToken = '';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

export const HOME_HEIGHT_M = 2_500_000;
const WORLD_VIEW = { lon: -30, lat: 25, height: 18_000_000 };
// Argus Dark shows vector countries above FADE_TOP and street tiles below
// FADE_BOTTOM, cross-fading in between.
const FADE_TOP = 3_200_000;
const FADE_BOTTOM = 1_200_000;
const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type Basemap = 'dark' | 'satellite' | 'hybrid';

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

// Hosted Esri tiles for street detail and imagery (no key needed for light
// use); milestone 2 adds self-hosted vector tiles and a provider key.
function basemapLayers(id: Basemap): ImageryLayer[] {
  if (id === 'dark') {
    return [
      new ImageryLayer(esri('Canvas/World_Dark_Gray_Base', 16, 'Esri, HERE, Garmin, © OpenStreetMap')),
      new ImageryLayer(esri('Canvas/World_Dark_Gray_Reference', 16)),
    ];
  }
  const imagery = new ImageryLayer(
    esri('World_Imagery', 19, 'Esri, Maxar, Earthstar Geographics'),
  );
  const base = [new ImageryLayer(blueMarble()), imagery];
  if (id === 'satellite') return base;
  return [
    ...base,
    new ImageryLayer(esri('Reference/World_Transportation', 19)),
    new ImageryLayer(esri('Reference/World_Boundaries_and_Places', 19)),
  ];
}

export interface GlobeHandle {
  flyHome: () => void;
  flyWorld: () => void;
  flyTo: (lat: number, lon: number, height?: number) => void;
  setMode: (mode: '3d' | '2d') => void;
}

interface Props {
  basemap: Basemap;
  home: Home | null;
  events: EventItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const Globe = forwardRef<GlobeHandle, Props>(function Globe(
  { basemap, home, events, selectedId, onSelect },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<CesiumWidget | null>(null);
  const points = useRef<PointPrimitiveCollection | null>(null);
  const rings = useRef<PointPrimitiveCollection | null>(null);
  const dark = useRef<DarkMap | null>(null);
  const tiles = useRef<ImageryLayer[]>([]);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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

    let disposed = false;
    void addDarkMap(scene).then((m) => {
      if (disposed) {
        m.destroy();
        return;
      }
      dark.current = m;
      applyFade();
    });

    // Cross-fade vector countries and street tiles with camera height.
    function applyFade() {
      const h = v.camera.positionCartographic.height;
      const t = Math.min(1, Math.max(0, (FADE_TOP - h) / (FADE_TOP - FADE_BOTTOM)));
      const isDark = basemapRef.current === 'dark';
      dark.current?.setVisible(isDark);
      if (isDark) dark.current?.setFade(1 - t);
      for (const layer of tiles.current) layer.alpha = isDark ? t : 1;
    }
    v.camera.percentageChanged = 0.02;
    const removeCamera = v.camera.changed.addEventListener(applyFade);
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
      viewer.current = null;
      points.current = null;
      rings.current = null;
    };
  }, []);

  // Base map: swap imagery layers; atmosphere only for imagery maps.
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.scene.imageryLayers.removeAll();
    tiles.current = basemapLayers(basemap);
    for (const layer of tiles.current) v.scene.imageryLayers.add(layer);
    const isDark = basemap === 'dark';
    v.scene.globe.showGroundAtmosphere = !isDark;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = !isDark;
    (v as unknown as { applyFade?: () => void }).applyFade?.();
  }, [basemap]);

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
  }, [events, selectedId]);

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
        },
        label: {
          text: 'HOME · ' + home.name.toUpperCase(),
          font: '500 12px "JetBrains Mono", monospace',
          fillColor: Color.fromCssColorString('#8fb8ff'),
          outlineColor: Color.fromCssColorString('#05080e'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
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
    () => ({
      flyHome() {
        const t = home ? { lon: home.lon, lat: home.lat, height: HOME_HEIGHT_M } : WORLD_VIEW;
        viewer.current?.camera.flyTo({
          destination: Cartesian3.fromDegrees(t.lon, t.lat, t.height),
          duration: 1.6,
        });
      },
      flyWorld() {
        // Centre the world view on home's longitude when there is one.
        const lon = home ? home.lon : WORLD_VIEW.lon;
        viewer.current?.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, 20, WORLD_VIEW.height),
          duration: 1.6,
        });
      },
      flyTo(lat, lon, height = 1_500_000) {
        viewer.current?.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, lat, height),
          duration: 1.4,
        });
      },
      setMode(mode) {
        const v = viewer.current;
        if (!v) return;
        if (mode === '2d' && v.scene.mode !== SceneMode.SCENE2D) v.scene.morphTo2D(1.2);
        if (mode === '3d' && v.scene.mode !== SceneMode.SCENE3D) v.scene.morphTo3D(1.2);
      },
    }),
    [home],
  );

  return <div ref={container} className="globe" aria-label="Globe" />;
});

export default Globe;
