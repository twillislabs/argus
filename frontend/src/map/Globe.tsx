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
  PointPrimitiveCollection,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  WebMapTileServiceImageryProvider,
} from '@cesium/engine';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { EventItem, Home } from '../lib/api';
import { SEVERITY_COLOR } from '../lib/format';

// No Cesium ion: every tile comes from a source we configure.
Ion.defaultAccessToken = '';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';

export const HOME_HEIGHT_M = 2_500_000;
const WORLD_VIEW = { lon: -30, lat: 25, height: 18_000_000 };

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
    credit: new Credit('Imagery: NASA GIBS, Blue Marble Shaded Relief and Bathymetry'),
  });
}

export interface GlobeHandle {
  flyHome: () => void;
  flyWorld: () => void;
  flyTo: (lat: number, lon: number, height?: number) => void;
  setMode: (mode: '3d' | '2d') => void;
}

interface Props {
  home: Home | null;
  events: EventItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const Globe = forwardRef<GlobeHandle, Props>(function Globe(
  { home, events, selectedId, onSelect },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<CesiumWidget | null>(null);
  const points = useRef<PointPrimitiveCollection | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current) return;
    const v = new CesiumWidget(container.current, {
      baseLayer: new ImageryLayer(blueMarble()),
    });
    v.scene.globe.baseColor = Color.fromCssColorString('#0a0f16');
    v.scene.backgroundColor = Color.fromCssColorString('#05080e');
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
    const collection = new PointPrimitiveCollection();
    v.scene.primitives.add(collection);
    points.current = collection;

    const handler = new ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = v.scene.pick(e.position);
      const id = picked && typeof picked.id === 'string' ? picked.id : null;
      onSelectRef.current(id);
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      const picked = v.scene.pick(e.endPosition);
      v.scene.canvas.style.cursor = picked && typeof picked.id === 'string' ? 'pointer' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);

    viewer.current = v;
    return () => {
      handler.destroy();
      v.destroy();
      viewer.current = null;
      points.current = null;
    };
  }, []);

  // Event markers: colour and size by severity, larger when selected.
  useEffect(() => {
    const collection = points.current;
    if (!collection) return;
    collection.removeAll();
    const outline = Color.fromCssColorString('#05080e');
    for (const e of events) {
      const selected = e.id === selectedId;
      const color = Color.fromCssColorString(SEVERITY_COLOR[e.severity] ?? '#7d93ad');
      collection.add({
        id: e.id,
        position: Cartesian3.fromDegrees(e.lon, e.lat),
        pixelSize: 5 + e.severity * 2 + (selected ? 6 : 0),
        color: e.status === 'candidate' ? color.withAlpha(0.45) : color,
        outlineColor: selected ? Color.WHITE : outline,
        outlineWidth: selected ? 2.5 : 1.2,
        scaleByDistance: new NearFarScalar(2.0e5, 1.6, 2.0e7, 0.8),
      });
    }
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
        const v = viewer.current;
        if (!v) return;
        // Centre the world view on home's longitude when there is one.
        const lon = home ? home.lon : WORLD_VIEW.lon;
        v.camera.flyTo({
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
