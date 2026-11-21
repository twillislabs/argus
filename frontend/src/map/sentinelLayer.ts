// Recent Sentinel imagery draped over a box (Recent imagery tool). The
// tiles come from our API (/api/imagery/tiles/...), which fetches and
// caches them; only the box is requested, from zoom 8 to 15.
//
// Close up, where Sentinel's 10 m pixels turn to blocks, sharper photos
// take over on top: Esri World Imagery (worldwide, from Esri like the
// Satellite basemap) and, in the US, NAIP aerial photos (about 0.6 m,
// through our API). The newer of the two goes on top and the other fills
// its gaps. They're ImageryLayers that only draw on terrain tiles from
// CLOSE_FROM_LEVEL down, and are left out while comparing, so both sides
// of the split stay Sentinel.
//
// Compare: a second, older pass shown left of a split line, the newer
// one right of it (scene.splitPosition, 0..1 across the canvas).

import { Rectangle } from '@cesium/core';
import { Credit, ImageryLayer, type Scene, SplitDirection, UrlTemplateImageryProvider } from '@cesium/engine';

export interface CloseUp {
  // NAIP aerial tiles ({z}/{x}/{y}), or null outside the US.
  naip: string | null;
  // Draw NAIP over Esri (it's the newer one here).
  naipOnTop: boolean;
}

export interface SentinelView {
  // west, south, east, north in degrees.
  box: [number, number, number, number];
  // Tile URL templates ({z}/{x}/{y}); before only when comparing.
  tiles: string;
  before?: string | null;
  // Sharper photos for close zoom, or null for Sentinel all the way.
  closeUp?: CloseUp | null;
  alpha: number;
  split: number;
}

export interface SentinelLayer {
  show: (view: SentinelView | null) => void;
  on: () => boolean;
  // Add the layers again after the base map swapped every layer out.
  reattach: () => void;
  // Back on top, after a base layer was added late (the street map).
  raise: () => void;
  destroy: () => void;
}

// Terrain level where close-up photos take over. Cesium's ellipsoid
// terrain level is about the same as a 512 px Web Mercator imagery level,
// and Sentinel-2's 10 m is level 13's texel size, so from 14 it's blocky.
const CLOSE_FROM_LEVEL = 14;
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

function naipFor(url: string, box: SentinelView['box']): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url,
    rectangle: Rectangle.fromDegrees(...box),
    tileWidth: 512,
    tileHeight: 512,
    minimumLevel: 13,
    maximumLevel: 17,
    credit: 'NAIP aerial photos: USDA (Microsoft Planetary Computer)',
  });
  return new ImageryLayer(provider, {
    rectangle: Rectangle.fromDegrees(...box),
    minimumTerrainLevel: CLOSE_FROM_LEVEL,
  });
}

function esriFor(box: SentinelView['box']): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: ESRI_IMAGERY,
    rectangle: Rectangle.fromDegrees(...box),
    minimumLevel: 14,
    maximumLevel: 19,
    credit: new Credit('Esri, Maxar, Earthstar Geographics'),
  });
  return new ImageryLayer(provider, {
    rectangle: Rectangle.fromDegrees(...box),
    minimumTerrainLevel: CLOSE_FROM_LEVEL,
  });
}

function layerFor(url: string, box: SentinelView['box']): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url,
    rectangle: Rectangle.fromDegrees(...box),
    // 512 px tiles (the API asks for @2x): sharper than 256 px ones.
    tileWidth: 512,
    tileHeight: 512,
    minimumLevel: 8,
    maximumLevel: 15,
    credit: 'Contains modified Copernicus Sentinel data (Microsoft Planetary Computer)',
  });
  return new ImageryLayer(provider, { rectangle: Rectangle.fromDegrees(...box) });
}

// What the close-up layers depend on, to rebuild them only on a change.
const closeKey = (v: SentinelView | null) =>
  v && v.closeUp && !v.before ? [v.box.join(), v.closeUp.naip ?? '', v.closeUp.naipOnTop].join('|') : '';

export function addSentinelLayer(scene: Scene): SentinelLayer {
  let main: ImageryLayer | null = null;
  let before: ImageryLayer | null = null;
  // Bottom first.
  let close: ImageryLayer[] = [];
  let current: SentinelView | null = null;

  const drop = (l: ImageryLayer | null) => {
    if (l && !scene.isDestroyed() && scene.imageryLayers.contains(l)) scene.imageryLayers.remove(l, true);
  };

  const api: SentinelLayer = {
    show(view) {
      const sameMain = view && current && view.tiles === current.tiles && view.box.join() === current.box.join();
      const sameBefore = view && current && sameMain && (view.before ?? null) === (current.before ?? null);
      if (!sameMain) {
        drop(main);
        main = view ? layerFor(view.tiles, view.box) : null;
        if (main) scene.imageryLayers.add(main);
      }
      if (!sameBefore) {
        drop(before);
        before = view?.before ? layerFor(view.before, view.box) : null;
        if (before) scene.imageryLayers.add(before);
      }
      if (closeKey(view) !== closeKey(current)) {
        close.forEach(drop);
        close = [];
        const c = view && !view.before ? view.closeUp : null;
        if (view && c) {
          const esri = esriFor(view.box);
          const naip = c.naip ? naipFor(c.naip, view.box) : null;
          close = naip ? (c.naipOnTop ? [esri, naip] : [naip, esri]) : [esri];
          close.forEach((l) => scene.imageryLayers.add(l));
        }
      }
      for (const l of close) {
        scene.imageryLayers.raiseToTop(l);
        if (view) l.alpha = view.alpha;
      }
      if (main && view) {
        main.alpha = view.alpha;
        main.splitDirection = before ? SplitDirection.RIGHT : SplitDirection.NONE;
      }
      if (before && view) {
        before.alpha = view.alpha;
        before.splitDirection = SplitDirection.LEFT;
      }
      scene.splitPosition = view?.split ?? 0.5;
      current = view;
      scene.requestRender();
    },
    on: () => current !== null,
    reattach() {
      // The base map's removeAll() destroyed our layers: forget them and
      // build them again on top of the new base.
      const view = current;
      main = before = null;
      close = [];
      current = null;
      if (view) api.show(view);
    },
    raise() {
      for (const l of [main, before, ...close]) {
        if (l && scene.imageryLayers.contains(l)) scene.imageryLayers.raiseToTop(l);
      }
    },
    destroy() {
      drop(main);
      drop(before);
      close.forEach(drop);
      main = before = null;
      close = [];
      current = null;
    },
  };
  return api;
}
