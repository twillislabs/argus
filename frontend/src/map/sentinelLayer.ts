// Recent Sentinel imagery draped over a box (Recent imagery tool). The
// tiles come from our API (/api/imagery/tiles/...), which fetches and
// caches them; only the box is requested, from zoom 8 to 15.
//
// Close up, where Sentinel's 10 m pixels turn to blocks, NAIP aerial
// photos (US only, about 0.6 m) take over on top: an ImageryLayer that
// only draws on terrain tiles from AERIAL_FROM_LEVEL down. Where there are
// none, its tiles are empty and the Sentinel pass shows through. Hidden
// while comparing, so both sides stay the same kind of picture.
//
// Compare: a second, older pass shown left of a split line, the newer
// one right of it (scene.splitPosition, 0..1 across the canvas).

import { Rectangle } from '@cesium/core';
import { ImageryLayer, type Scene, SplitDirection, UrlTemplateImageryProvider } from '@cesium/engine';

export interface SentinelView {
  // west, south, east, north in degrees.
  box: [number, number, number, number];
  // Tile URL templates ({z}/{x}/{y}); before only when comparing.
  tiles: string;
  before?: string | null;
  // NAIP aerial tiles for close zoom, or null.
  aerial?: string | null;
  alpha: number;
  split: number;
}

export interface SentinelLayer {
  show: (view: SentinelView | null) => void;
  on: () => boolean;
  destroy: () => void;
}

// Terrain level where aerial photos take over. Cesium's ellipsoid terrain
// level is about the same as a 512 px Web Mercator imagery level, and
// Sentinel-2's 10 m is level 13's texel size, so from 14 it's blocky.
const AERIAL_FROM_LEVEL = 14;

function aerialFor(url: string, box: SentinelView['box']): ImageryLayer {
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
    minimumTerrainLevel: AERIAL_FROM_LEVEL,
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

export function addSentinelLayer(scene: Scene): SentinelLayer {
  let main: ImageryLayer | null = null;
  let before: ImageryLayer | null = null;
  let aerial: ImageryLayer | null = null;
  let current: SentinelView | null = null;

  const drop = (l: ImageryLayer | null) => {
    if (l && !scene.isDestroyed() && scene.imageryLayers.contains(l)) scene.imageryLayers.remove(l, true);
  };

  return {
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
      const aerialUrl = view && !view.before ? (view.aerial ?? null) : null;
      const sameAerial =
        current &&
        view &&
        view.box.join() === current.box.join() &&
        aerialUrl === (current.before ? null : (current.aerial ?? null));
      if (!sameAerial) {
        drop(aerial);
        aerial = aerialUrl && view ? aerialFor(aerialUrl, view.box) : null;
        if (aerial) scene.imageryLayers.add(aerial);
      }
      if (aerial) {
        scene.imageryLayers.raiseToTop(aerial);
        if (view) aerial.alpha = view.alpha;
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
    destroy() {
      drop(main);
      drop(before);
      drop(aerial);
      main = before = aerial = null;
      current = null;
    },
  };
}
