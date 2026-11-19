// Recent Sentinel imagery draped over a box (Recent imagery tool). The
// tiles come from our API (/api/imagery/tiles/...), which fetches and
// caches them; only the box is requested, from zoom 8 to 15.
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
  alpha: number;
  split: number;
}

export interface SentinelLayer {
  show: (view: SentinelView | null) => void;
  on: () => boolean;
  destroy: () => void;
}

function layerFor(url: string, box: SentinelView['box']): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url,
    rectangle: Rectangle.fromDegrees(...box),
    minimumLevel: 8,
    maximumLevel: 15,
    credit: 'Contains modified Copernicus Sentinel data (Microsoft Planetary Computer)',
  });
  return new ImageryLayer(provider, { rectangle: Rectangle.fromDegrees(...box) });
}

export function addSentinelLayer(scene: Scene): SentinelLayer {
  let main: ImageryLayer | null = null;
  let before: ImageryLayer | null = null;
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
      main = before = null;
      current = null;
    },
  };
}
