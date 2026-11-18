import '@cesium/engine/Source/Widget/CesiumWidget.css';

// The core engine only: the full `cesium` package also bundles Knockout
// for its Viewer widgets, which needs `eval` and breaks our strict CSP.
import { Cartesian2, Cartesian3, Color, Rectangle } from '@cesium/core';
import {
  CesiumWidget,
  Credit,
  GeographicTilingScheme,
  ImageryLayer,
  Ion,
  LabelStyle,
  SceneMode,
  VerticalOrigin,
  WebMapTileServiceImageryProvider,
} from '@cesium/engine';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { Home } from '../lib/api';

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
  setMode: (mode: '3d' | '2d') => void;
}

interface Props {
  home: Home | null;
}

const Globe = forwardRef<GlobeHandle, Props>(function Globe({ home }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<CesiumWidget | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const v = new CesiumWidget(container.current, {
      baseLayer: new ImageryLayer(blueMarble()),
    });
    v.scene.globe.baseColor = Color.fromCssColorString('#0a0f16');
    v.scene.backgroundColor = Color.fromCssColorString('#05080e');
    v.scene.globe.enableLighting = false;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
    viewer.current = v;
    return () => {
      v.destroy();
      viewer.current = null;
    };
  }, []);

  // Home marker and start view.
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
    const target = home
      ? { lon: home.lon, lat: home.lat, height: HOME_HEIGHT_M }
      : WORLD_VIEW;
    v.camera.setView({
      destination: Cartesian3.fromDegrees(target.lon, target.lat, target.height),
    });
  }, [home]);

  useImperativeHandle(
    ref,
    () => ({
      flyHome() {
        const v = viewer.current;
        if (!v) return;
        const t = home
          ? { lon: home.lon, lat: home.lat, height: HOME_HEIGHT_M }
          : WORLD_VIEW;
        v.camera.flyTo({
          destination: Cartesian3.fromDegrees(t.lon, t.lat, t.height),
          duration: 1.6,
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
