import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { cursorStore } from '../lib/cursor';
import type { EventItem } from '../lib/api';
import { TYPE_INFO } from '../lib/format';
import { toMgrs } from '../lib/mgrs';
import { altitude, roundDistance } from '../lib/units';

// Bottom left of the map: MGRS and lat/lon under the cursor, and the
// camera's eye altitude (as in the mock-up).
export function CursorReadout() {
  const c = useSyncExternalStore(cursorStore.subscribe, cursorStore.get);
  const ll =
    c.lat === null || c.lon === null
      ? '—'
      : Math.abs(c.lat).toFixed(4) +
        '°' +
        (c.lat >= 0 ? 'N' : 'S') +
        ' ' +
        Math.abs(c.lon).toFixed(4) +
        '°' +
        (c.lon >= 0 ? 'E' : 'W');
  return (
    <div className="readout" aria-label="Cursor position">
      <span>MGRS</span>
      <b>{c.lat !== null && c.lon !== null ? (toMgrs(c.lat, c.lon) ?? '—') : '—'}</b>
      <span>LAT/LON</span>
      <b>{ll}</b>
      <span>EYE ALT</span>
      <b>{altitude(c.eyeAlt)}</b>
    </div>
  );
}

// Bottom right: a scale bar about 100 px long with a round distance.
export function ScaleBar() {
  const c = useSyncExternalStore(cursorStore.subscribe, cursorStore.get);
  if (!c.metresPerPixel) return null;
  const step = roundDistance(c.metresPerPixel * 100);
  const width = Math.max(20, Math.round(step.metres / c.metresPerPixel));
  return (
    <div className="scalebar" aria-label={'Scale ' + step.label}>
      <span>{step.label}</span>
      <i style={{ width }} />
    </div>
  );
}

function dtg(d: Date): string {
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    'Z ' +
    mon +
    ' ' +
    String(d.getUTCFullYear()).slice(2)
  );
}

// Replay state: t is the cursor (null = live), from/to an optional time
// filter (Shift-drag), speed in seconds of history per second.
export interface Replay {
  t: number | null;
  from: number | null;
  to: number | null;
  playing: boolean;
  speed: number;
}

export const LIVE: Replay = { t: null, from: null, to: null, playing: false, speed: 600 };
const SPEEDS = [60, 600, 3600, 6 * 3600];
const speedLabel = (s: number) => (s < 3600 ? s / 60 + ' min/s' : s / 3600 + ' h/s');

// Under the map (Foundry Map-style timeline): events per bin across the
// time window, stacked by type; click or drag to move the cursor and see
// the map as it was, Shift-drag to filter a range, play to step through.
export function Timeline({
  events,
  hours,
  replay,
  onReplay,
}: {
  events: EventItem[];
  hours: number;
  replay: Replay;
  onReplay: (r: Replay) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const plot = useRef<HTMLDivElement>(null);
  const drag = useRef<{ shift: boolean; start: number; end: number } | null>(null);
  const [band, setBand] = useState<[number, number] | null>(null);
  const start = now - hours * 3_600_000;
  const span = now - start;
  const binsN = 48;
  const binMs = span / binsN;
  const bins: Record<string, number>[] = Array.from({ length: binsN }, () => ({}));
  for (const e of events) {
    const i = Math.floor((Date.parse(e.first_seen) - start) / binMs);
    if (i < 0 || i >= binsN) continue;
    bins[i][e.type] = (bins[i][e.type] ?? 0) + 1;
  }
  const max = Math.max(1, ...bins.map((b) => Object.values(b).reduce((a, n) => a + n, 0)));
  const w = 100 / binsN;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const timeAt = (clientX: number) => {
    const r = plot.current?.getBoundingClientRect();
    if (!r) return now;
    return start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };
  const range = band ?? (replay.from !== null && replay.to !== null ? [replay.from, replay.to] : null);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const h = Math.round(hours * (1 - f));
    return h === 0 ? 'now' : h >= 48 ? '-' + Math.round(h / 24) + 'd' : '-' + h + 'h';
  });
  const cursor = replay.t ?? now;
  return (
    <div className="timeline">
      <div className="tlrow">
        <div className="tlctl">
          <button
            className="btn small"
            aria-label={replay.playing ? 'Pause' : 'Play'}
            title={replay.playing ? 'Pause' : 'Play through the time window'}
            onClick={() =>
              onReplay({
                ...replay,
                playing: !replay.playing,
                t: replay.t ?? replay.from ?? start,
              })
            }
          >
            {replay.playing ? '❚❚' : '▶'}
          </button>
          <select
            className="tlspeed"
            aria-label="Playback speed"
            value={replay.speed}
            onChange={(e) => onReplay({ ...replay, speed: Number(e.target.value) })}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {speedLabel(s)}
              </option>
            ))}
          </select>
          <button
            className={'btn small' + (replay.t === null ? ' on' : '')}
            title="Back to live (View latest)"
            onClick={() => onReplay({ ...LIVE, speed: replay.speed })}
          >
            Live
          </button>
        </div>
        <div
          className="tlplot"
          ref={plot}
          title="Click or drag to see the map at that time · Shift-drag to filter a range · double-click clears the filter"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const t = timeAt(e.clientX);
            drag.current = { shift: e.shiftKey, start: t, end: t };
            if (!e.shiftKey) onReplay({ ...replay, t, playing: false });
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const t = timeAt(e.clientX);
            drag.current.end = t;
            if (drag.current.shift) setBand([Math.min(drag.current.start, t), Math.max(drag.current.start, t)]);
            else onReplay({ ...replay, t, playing: false });
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (d?.shift) {
              const end = timeAt(e.clientX);
              const lo = Math.min(d.start, end);
              const hi = Math.max(d.start, end);
              if (hi - lo > binMs / 4) {
                onReplay({
                  ...replay,
                  from: lo,
                  to: hi,
                  t: replay.t !== null ? Math.min(Math.max(replay.t, lo), hi) : null,
                });
              }
            }
            drag.current = null;
            setBand(null);
          }}
          onDoubleClick={() => onReplay({ ...replay, from: null, to: null })}
        >
          <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
            {range && (
              <rect x={pct(range[0])} y={0} width={pct(range[1]) - pct(range[0])} height={34} className="tlband" />
            )}
            {bins.map((b, i) => {
              let y = 34;
              const t = start + (i + 0.5) * binMs;
              const dim = (range && (t < range[0] || t > range[1])) || (replay.t !== null && t > replay.t);
              return Object.entries(b).map(([type, n]) => {
                const hgt = (n / max) * 32;
                y -= hgt;
                return (
                  <rect
                    key={i + type}
                    x={i * w + w * 0.12}
                    y={y}
                    width={w * 0.76}
                    height={hgt}
                    fill={TYPE_INFO[type as keyof typeof TYPE_INFO]?.color ?? '#7d93ad'}
                    opacity={dim ? 0.25 : 0.85}
                  />
                );
              });
            })}
          </svg>
          {replay.t !== null && <div className="playhead" style={{ left: pct(cursor) + '%' }} />}
          <div className="tlaxis mono">
            {ticks.map((l, i) => (
              <span key={l + i} style={{ left: i * 25 + '%' }}>
                {l}
              </span>
            ))}
          </div>
        </div>
        <span className={'tltime' + (replay.t !== null ? ' replay' : '')}>
          {replay.t === null ? 'LIVE' : 'REPLAY'} · {dtg(new Date(cursor))}
          {replay.from !== null && replay.to !== null && (
            <small className="mono">
              {' '}
              filter {dtg(new Date(replay.from)).slice(0, 7)}–{dtg(new Date(replay.to)).slice(0, 7)}
            </small>
          )}
        </span>
      </div>
    </div>
  );
}
