// Rocket launches (Launch Library 2): a marker at each launch's pad,
// coloured by status, with its rocket's name close in. Upcoming
// launches in the next 48 hours get a ring. Pickable as "launch:<id>".
// Up close, a pad with a launch coming stands a 3D rocket on it: a model
// of its family where there is one (rocketModel, from the name Launch
// Library gives), else a generic two-stage rocket (rocket.glb). Models
// from backend/scripts/build_models.py.

import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  FixedFrameTransforms,
  NearFarScalar,
} from '@cesium/core';
import {
  BillboardCollection,
  Model,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  type Scene,
  VerticalOrigin,
} from '@cesium/engine';

import type { Launch } from '../lib/api';

export const LAUNCH_COLOR = {
  soon: '#ffd166', // next 48 hours
  upcoming: '#c9a2ff',
  success: '#4fd18b',
  failure: '#ff5260',
  other: '#9aa7ba',
};

export function launchColor(l: Launch, now = Date.now()): string {
  const t = l.net ? Date.parse(l.net) : NaN;
  const s = l.status.toLowerCase();
  if (s === 'success') return LAUNCH_COLOR.success;
  if (s.includes('fail')) return LAUNCH_COLOR.failure;
  if (Number.isFinite(t) && t >= now) return t - now < 48 * 3600_000 ? LAUNCH_COLOR.soon : LAUNCH_COLOR.upcoming;
  return LAUNCH_COLOR.other;
}

export const padKey = (l: Launch) => l.lat.toFixed(3) + ',' + l.lon.toFixed(3);

// Launches grouped by pad, each group in time order.
export function byPad(items: Launch[]): Map<string, Launch[]> {
  const out = new Map<string, Launch[]>();
  for (const l of [...items].sort((a, b) => (a.net ?? '').localeCompare(b.net ?? ''))) {
    const list = out.get(padKey(l)) ?? [];
    list.push(l);
    out.set(padKey(l), list);
  }
  return out;
}

// The launch a pad's marker shows: its next one, else its latest.
export function padLead(group: Launch[], now = Date.now()): Launch {
  return group.find((l) => l.net && Date.parse(l.net) >= now) ?? group[group.length - 1];
}

export interface LaunchLayer {
  update: (items: Launch[], visible: boolean) => void;
  setDepthDistance: (metres: number) => void;
  destroy: () => void;
}

const LABEL_RANGE = new DistanceDisplayCondition(0, 3.0e6);

// Rocket families with their own model, and each model's height (m).
const ROCKETS: [RegExp, string, number][] = [
  [/falcon heavy/i, 'falcon-heavy', 70],
  [/starship|super heavy/i, 'starship', 121],
  [/new glenn/i, 'new-glenn', 98],
  [/vulcan/i, 'vulcan', 62],
  [/atlas v/i, 'atlas-v', 58],
  [/ariane 62/i, 'ariane62', 62],
  [/ariane 6/i, 'ariane64', 62],
  [/soyuz/i, 'soyuz', 46],
  [/long march 2f/i, 'long-march-crew', 59],
  [/long march (2c|2d|4|6c|6$|6 )/i, 'long-march-core', 50],
  [/long march/i, 'long-march', 52],
  [/electron/i, 'electron', 18],
  [/kuaizhou|kinetica|ceres|jielong|lijian|vega|minotaur|pegasus|mir\b|hyperbola|epsilon/i, 'small', 28],
];
// Falcon 9 flights carrying Dragon (crew and cargo) by mission name.
const DRAGON = /dragon|crew-|crs-|ax-\d|axiom|fram2|vast/i;

// The model file (under /models/) for a launch, and its height in metres.
export function rocketModel(l: Launch): { file: string; height: number } {
  const name = l.rocket ?? l.name;
  if (/falcon 9/i.test(name)) {
    return DRAGON.test(l.name + ' ' + (l.mission ?? ''))
      ? { file: 'rocket-falcon9-dragon', height: 65 }
      : { file: 'rocket-falcon9', height: 70 };
  }
  for (const [re, file, height] of ROCKETS) if (re.test(name)) return { file: 'rocket-' + file, height };
  return { file: 'rocket', height: 71 };
}
// The 3D rocket shows inside MODEL_RANGE; the flat marker hands over to
// it inside ICON_FROM.
const MODEL_RANGE = new DistanceDisplayCondition(0, 40_000);
const ICON_FROM = new DistanceDisplayCondition(12_000, Number.MAX_VALUE);

// A small rocket, so launches don't read as event dots. Soon: ringed.
function rocket(color: string, ring: boolean): HTMLCanvasElement {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  if (!g) return c;
  if (ring) {
    g.beginPath();
    g.arc(16, 16, 14, 0, 2 * Math.PI);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();
  }
  g.beginPath();
  g.moveTo(16, 5); // nose
  g.quadraticCurveTo(21, 10, 20, 20);
  g.lineTo(23, 25); // fins
  g.lineTo(9, 25);
  g.lineTo(12, 20);
  g.quadraticCurveTo(11, 10, 16, 5);
  g.closePath();
  g.fillStyle = color;
  g.strokeStyle = '#05080e';
  g.lineWidth = 1.5;
  g.fill();
  g.stroke();
  return c;
}

export function addLaunchLayer(scene: Scene): LaunchLayer {
  const points = new BillboardCollection({ scene });
  const labels = new LabelCollection({ scene });
  scene.primitives.add(points);
  const icons = new Map<string, HTMLCanvasElement>();
  const icon = (color: string, ring: boolean) => {
    const key = color + ring;
    if (!icons.has(key)) icons.set(key, rocket(color, ring));
    return icons.get(key) as HTMLCanvasElement;
  };
  scene.primitives.add(labels);
  let depth = 0;
  // One standing rocket per pad with a launch coming, kept by launch id.
  const rockets = new Map<string, Model | null>();
  let destroyed = false;
  function standRocket(id: string, lat: number, lon: number, file: string) {
    if (rockets.has(id)) {
      const m = rockets.get(id);
      if (m) m.show = true;
      return;
    }
    rockets.set(id, null);
    void Model.fromGltfAsync({
      url: '/models/' + file + '.glb',
      id: 'launch:' + id,
      modelMatrix: FixedFrameTransforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, 0)),
      minimumPixelSize: 28,
      distanceDisplayCondition: MODEL_RANGE,
    })
      .then((m) => {
        if (destroyed || scene.isDestroyed() || !rockets.has(id)) {
          m.destroy();
          return;
        }
        rockets.set(id, m);
        scene.primitives.add(m);
      })
      .catch(() => undefined);
  }
  const dark = Color.fromCssColorString('#05080e');
  const scale = new NearFarScalar(3e5, 1.0, 2e7, 0.7);
  return {
    update(items, visible) {
      points.removeAll();
      labels.removeAll();
      const standing = new Set<string>();
      const now = Date.now();
      for (const group of visible ? byPad(items).values() : []) {
        const l = padLead(group, now);
        const coming = Boolean(l.net && Date.parse(l.net) >= now);
        if (coming) {
          standing.add(l.id);
          standRocket(l.id, l.lat, l.lon, rocketModel(l).file);
        }
        const position = Cartesian3.fromDegrees(l.lon, l.lat, 2000);
        const color = Color.fromCssColorString(launchColor(l, now));
        const soon = launchColor(l, now) === LAUNCH_COLOR.soon;
        points.add({
          id: 'launch:' + l.id,
          position,
          image: icon(launchColor(l, now), soon),
          scaleByDistance: scale,
          disableDepthTestDistance: depth,
          distanceDisplayCondition: coming ? ICON_FROM : undefined,
        });
        labels.add({
          id: 'launch:' + l.id,
          position,
          text: (l.rocket ?? l.name).slice(0, 40) + (group.length > 1 ? ' +' + (group.length - 1) : ''),
          font: '500 10.5px Inter, system-ui, sans-serif',
          fillColor: color,
          outlineColor: dark,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(9, 0),
          distanceDisplayCondition: LABEL_RANGE,
          disableDepthTestDistance: depth,
        });
      }
      for (const [id, m] of rockets) {
        if (standing.has(id)) continue;
        if (m && !scene.isDestroyed()) scene.primitives.remove(m);
        rockets.delete(id);
      }
    },
    setDepthDistance(metres) {
      depth = metres;
      for (let i = 0; i < points.length; i++) points.get(i).disableDepthTestDistance = metres;
      for (let i = 0; i < labels.length; i++) labels.get(i).disableDepthTestDistance = metres;
    },
    destroy() {
      destroyed = true;
      for (const m of rockets.values()) if (m && !scene.isDestroyed()) scene.primitives.remove(m);
      rockets.clear();
      for (const p of [points, labels])
        if (!scene.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
    },
  };
}
