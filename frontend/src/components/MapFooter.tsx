import { useEffect, useState, useSyncExternalStore } from 'react';

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
      : Math.abs(c.lat).toFixed(4) + '°' + (c.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(c.lon).toFixed(4) + '°' + (c.lon >= 0 ? 'E' : 'W');
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
  return p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z ' + mon + ' ' + String(d.getUTCFullYear()).slice(2);
}

// Under the map: events per hour over the last 24 hours, stacked by type
// and coloured like the layers, with the live time on the right.
export function Timeline({ events }: { events: EventItem[] }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const hours = 24;
  const bins: Record<string, number>[] = Array.from({ length: hours }, () => ({}));
  const t = now.getTime();
  for (const e of events) {
    const h = Math.floor((t - Date.parse(e.first_seen)) / 3_600_000);
    if (h < 0 || h >= hours) continue;
    const bin = bins[hours - 1 - h];
    bin[e.type] = (bin[e.type] ?? 0) + 1;
  }
  const max = Math.max(1, ...bins.map((b) => Object.values(b).reduce((a, n) => a + n, 0)));
  const w = 100 / hours;
  return (
    <div className="timeline">
      <div className="tlrow">
        <span className="tltitle cap">Activity · 24h</span>
        <div className="tlplot">
          <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
            {bins.map((b, i) => {
              let y = 34;
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
                    opacity="0.85"
                  >
                    <title>
                      {n} {TYPE_INFO[type as keyof typeof TYPE_INFO]?.label ?? type}, {hours - i} h ago
                    </title>
                  </rect>
                );
              });
            })}
          </svg>
          <div className="tlaxis mono">
            {['-24h', '-18h', '-12h', '-6h', 'now'].map((l, i) => (
              <span key={l} style={{ left: i * 25 + '%' }}>
                {l}
              </span>
            ))}
          </div>
        </div>
        <span className="tltime">LIVE · {dtg(now)}</span>
      </div>
    </div>
  );
}
