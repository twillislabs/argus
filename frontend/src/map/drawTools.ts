// Drawing, measuring and area selection on the map (Foundry Map-style
// toolbar). Shapes are kept as lon/lat points; the map page saves them in
// the user's preferences. While a tool is active, clicks go here instead
// of selecting things on the map.

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  Math as CesiumMath,
  PolygonGeometry,
  PolygonHierarchy,
} from '@cesium/core';
import {
  type CesiumWidget,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolylineCollection,
  Primitive,
  VerticalOrigin,
} from '@cesium/engine';

import { circleRing, densify, distanceKm, type LonLat, pathKm, rectRing, ringAreaKm2 } from '../lib/geo';
import { distance } from '../lib/units';

export type ShapeKind = 'point' | 'line' | 'polygon' | 'rectangle' | 'circle' | 'text' | 'measure';
export type Tool = 'none' | ShapeKind | 'delete' | 'select-box' | 'select-polygon' | 'select-circle' | 'imagery-box';

export interface Drawing {
  id: string;
  kind: ShapeKind;
  points: LonLat[];
  // Circles: radius in km (points[0] is the centre).
  radius_km?: number;
  label?: string;
}

export const DRAW_COLOR = '#5b9bff';
const SELECT_COLOR = '#f0c94a';
const HEIGHT = 1500;

// The closed ring a shape covers, for selection (null for lines, points).
export function shapeRing(d: Pick<Drawing, 'kind' | 'points' | 'radius_km'>): LonLat[] | null {
  if (d.kind === 'circle' && d.points.length && d.radius_km) return circleRing(d.points[0], d.radius_km);
  if (d.kind === 'rectangle' && d.points.length >= 2) return rectRing(d.points[0], d.points[1]);
  if (d.kind === 'polygon' && d.points.length >= 3) return [...d.points, d.points[0]];
  return null;
}

// What a finished shape measures, for its label.
export function describeShape(d: Drawing): string {
  const ring = shapeRing(d);
  if (d.kind === 'measure' || d.kind === 'line') return distance(pathKm(d.points));
  if (d.kind === 'circle' && d.radius_km) return 'radius ' + distance(d.radius_km);
  if (ring) {
    const km2 = ringAreaKm2(ring);
    return (km2 * 0.386102).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' sq mi';
  }
  return '';
}

export interface DrawCallbacks {
  // A new shape was drawn (not for select tools).
  onDrawn: (d: Drawing) => void;
  // A select tool finished: the area to select inside.
  onSelectArea: (ring: LonLat[]) => void;
  // The Recent imagery tool finished: the box to fetch imagery for.
  onImageryArea?: (ring: LonLat[]) => void;
  onDelete: (id: string) => void;
  // The text tool was clicked here: ask for the text.
  onText: (at: LonLat, screen: { x: number; y: number }) => void;
  // A hint for the status line, or null when no tool is active.
  onHint: (hint: string | null) => void;
}

export interface DrawTools {
  tool: () => Tool;
  setTool: (t: Tool) => void;
  setDrawings: (list: Drawing[]) => void;
  // Input from the globe: true when the tool used the event.
  click: (pos: Cartesian2) => boolean;
  doubleClick: (pos: Cartesian2) => boolean;
  move: (pos: Cartesian2) => void;
  undo: () => void;
  finish: () => void;
  cancel: () => void;
  destroy: () => void;
}

const HINTS: Record<Tool, string | null> = {
  none: null,
  point: 'Click to place a point · Esc to stop',
  line: 'Click to add points · double-click or Enter to finish · Backspace undoes · Esc cancels',
  polygon: 'Click to add corners · double-click or Enter to finish · Backspace undoes · Esc cancels',
  rectangle: 'Click one corner, then the opposite corner · Esc cancels',
  circle: 'Click the centre, then a point on the edge · Esc cancels',
  text: 'Click where the note goes · Esc to stop',
  measure: 'Click to add points · double-click or Enter to finish · Esc cancels',
  delete: 'Click a drawn shape to delete it · Esc to stop',
  'imagery-box':
    'Click one corner, then the opposite corner, for recent satellite imagery (up to about 100 km) · Esc cancels',
  'select-box': 'Click one corner, then the opposite corner, to select what’s inside · Esc cancels',
  'select-polygon': 'Click around the area to select · double-click or Enter to finish · Esc cancels',
  'select-circle': 'Click the centre, then the edge, to select what’s inside · Esc cancels',
};

export function createDrawTools(v: CesiumWidget, cb: DrawCallbacks): DrawTools {
  const scene = v.scene;
  const lines = new PolylineCollection();
  const points = new PointPrimitiveCollection();
  const labels = new LabelCollection({ scene });
  const previewLines = new PolylineCollection();
  const previewPoints = new PointPrimitiveCollection();
  const previewLabels = new LabelCollection({ scene });
  for (const p of [lines, points, labels, previewLines, previewPoints, previewLabels]) scene.primitives.add(p);
  let fills: Primitive | null = null;
  let tool: Tool = 'none';
  let pending: LonLat[] = [];
  let cursor: LonLat | null = null;
  let drawings: Drawing[] = [];

  const lineMaterial = (css: string, alpha = 1) =>
    Material.fromType('Color', { color: Color.fromCssColorString(css).withAlpha(alpha) });
  // The shape being drawn: a dashed line until the last click, so it
  // reads as a preview, not a finished drawing.
  const previewMaterial = (css: string) =>
    Material.fromType('PolylineDash', {
      color: Color.fromCssColorString(css),
      gapColor: Color.fromCssColorString('#05080e').withAlpha(0.35),
      dashLength: 14,
    });
  const toCart = (p: LonLat, h = HEIGHT) => Cartesian3.fromDegrees(p[0], p[1], h);
  const label = (coll: LabelCollection, at: LonLat, text: string, color = '#d4dae2') =>
    coll.add({
      position: toCart(at, HEIGHT + 200),
      text,
      font: '500 11px "JetBrains Mono", monospace',
      fillColor: Color.fromCssColorString(color),
      outlineColor: Color.fromCssColorString('#05080e'),
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(8, -6),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      // A dark plate so measurements read over map names.
      showBackground: true,
      backgroundColor: Color.fromCssColorString('rgba(13,17,23,0.85)'),
      backgroundPadding: new Cartesian2(6, 4),
    });

  function pick(pos: Cartesian2): LonLat | null {
    const at = v.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
    if (!at) return null;
    const c = Cartographic.fromCartesian(at);
    return [CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)];
  }

  function outline(d: Pick<Drawing, 'kind' | 'points' | 'radius_km'>): LonLat[] {
    return shapeRing(d) ?? d.points;
  }

  function render() {
    lines.removeAll();
    points.removeAll();
    labels.removeAll();
    if (fills && scene.primitives.contains(fills)) scene.primitives.remove(fills);
    fills = null;
    const instances: GeometryInstance[] = [];
    for (const d of drawings) {
      const id = 'draw:' + d.id;
      const color = DRAW_COLOR;
      if (d.kind === 'point' || d.kind === 'text') {
        points.add({
          id,
          position: toCart(d.points[0]),
          pixelSize: 8,
          color: Color.fromCssColorString(color),
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        if (d.label) label(labels, d.points[0], d.label);
        continue;
      }
      const ring = outline(d);
      if (ring.length >= 2) {
        lines.add({
          id,
          positions: densify(ring).map((p) => toCart(p)),
          width: 2,
          material: lineMaterial(color, d.kind === 'measure' ? 1 : 0.9),
        });
      }
      const ringClosed = shapeRing(d);
      if (ringClosed) {
        instances.push(
          new GeometryInstance({
            id,
            geometry: new PolygonGeometry({
              polygonHierarchy: new PolygonHierarchy(ringClosed.slice(0, -1).map((p) => toCart(p, 0))),
              height: HEIGHT,
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(color).withAlpha(0.12)),
            },
          }),
        );
      }
      const text = [d.label, describeShape(d)].filter(Boolean).join(' · ');
      if (text)
        label(labels, d.kind === 'measure' || d.kind === 'line' ? d.points[d.points.length - 1] : d.points[0], text);
    }
    if (instances.length) {
      fills = new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false,
      });
      scene.primitives.add(fills);
    }
  }

  function renderPreview() {
    previewLines.removeAll();
    previewPoints.removeAll();
    previewLabels.removeAll();
    if (tool === 'none' || tool === 'delete') return;
    const selecting = tool.startsWith('select');
    const color = selecting ? SELECT_COLOR : DRAW_COLOR;
    const pts = cursor ? [...pending, cursor] : pending;
    for (const p of pending) {
      previewPoints.add({
        position: toCart(p),
        pixelSize: 6,
        color: Color.fromCssColorString(color),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    if (pts.length < 2) return;
    let shape: LonLat[] = pts;
    let text = '';
    const kind =
      tool === 'select-box' || tool === 'imagery-box'
        ? 'rectangle'
        : tool === 'select-circle'
          ? 'circle'
          : tool === 'select-polygon'
            ? 'polygon'
            : tool;
    if (kind === 'rectangle') shape = rectRing(pts[0], pts[pts.length - 1]);
    else if (kind === 'circle') {
      const r = distanceKm(pts[0], pts[pts.length - 1]);
      shape = circleRing(pts[0], r);
      text = 'radius ' + distance(r);
    } else if (kind === 'polygon') shape = [...pts, pts[0]];
    if (kind === 'measure' || kind === 'line') text = distance(pathKm(pts));
    previewLines.add({ positions: densify(shape).map((p) => toCart(p)), width: 2.5, material: previewMaterial(color) });
    if (text) label(previewLabels, pts[pts.length - 1], text, color);
  }

  function reset() {
    pending = [];
    renderPreview();
  }

  function complete() {
    const t = tool;
    if (t === 'none' || t === 'delete' || t === 'text' || t === 'point') return;
    const kind: ShapeKind =
      t === 'select-box' || t === 'imagery-box'
        ? 'rectangle'
        : t === 'select-circle'
          ? 'circle'
          : t === 'select-polygon'
            ? 'polygon'
            : t;
    const need = kind === 'polygon' ? 3 : 2;
    if (pending.length < need) return;
    const shape: Drawing = { id: Date.now().toString(36), kind, points: [...pending] };
    if (kind === 'circle') {
      shape.points = [pending[0]];
      shape.radius_km = distanceKm(pending[0], pending[1]);
    } else if (kind === 'rectangle') {
      shape.points = [pending[0], pending[1]];
    }
    reset();
    if (t === 'imagery-box') {
      const ring = shapeRing(shape);
      if (ring) cb.onImageryArea?.(ring);
    } else if (t.startsWith('select')) {
      const ring = shapeRing(shape);
      if (ring) cb.onSelectArea(ring);
    } else {
      cb.onDrawn(shape);
    }
  }

  return {
    tool: () => tool,
    setTool(t) {
      tool = t;
      pending = [];
      cursor = null;
      renderPreview();
      cb.onHint(HINTS[t]);
      scene.canvas.style.cursor = t === 'none' ? '' : 'crosshair';
    },
    setDrawings(list) {
      drawings = list;
      render();
    },
    click(pos) {
      if (tool === 'none') return false;
      if (tool === 'delete') {
        const picked = scene.pick(pos);
        const id = picked && typeof picked.id === 'string' && picked.id.startsWith('draw:') ? picked.id.slice(5) : null;
        if (id) cb.onDelete(id);
        return true;
      }
      const at = pick(pos);
      if (!at) return true;
      if (tool === 'point') {
        cb.onDrawn({ id: Date.now().toString(36), kind: 'point', points: [at] });
        return true;
      }
      if (tool === 'text') {
        cb.onText(at, { x: pos.x, y: pos.y });
        return true;
      }
      pending.push(at);
      const twoClick =
        tool === 'rectangle' ||
        tool === 'circle' ||
        tool === 'select-box' ||
        tool === 'select-circle' ||
        tool === 'imagery-box';
      if (twoClick && pending.length === 2) complete();
      else renderPreview();
      return true;
    },
    doubleClick() {
      if (tool === 'none') return false;
      // The double-click's two clicks already added the last point twice.
      if (pending.length >= 2) pending.pop();
      complete();
      return true;
    },
    move(pos) {
      if (tool === 'none' || tool === 'delete' || tool === 'point' || tool === 'text') return;
      if (!pending.length) return;
      cursor = pick(pos);
      renderPreview();
    },
    undo() {
      pending.pop();
      renderPreview();
    },
    finish: complete,
    cancel() {
      if (pending.length) reset();
      else this.setTool('none');
    },
    destroy() {
      if (scene.isDestroyed()) return;
      for (const p of [lines, points, labels, previewLines, previewPoints, previewLabels, fills]) {
        if (p && !p.isDestroyed() && scene.primitives.contains(p)) scene.primitives.remove(p);
      }
    },
  };
}
