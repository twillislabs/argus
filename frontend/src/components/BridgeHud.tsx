import { useEffect, useRef, useState } from 'react';

import type { Vessel } from '../lib/api';
import { COCKPIT_PITCH } from '../map/aircraftCamera';
import { HeadingTape, horizonY, pad } from './CockpitHud';

// A bridge display over a ship's bridge view: a compass tape on the
// camera's heading with the course over ground as a bug, speed and
// course boxes, the gyro heading where AIS sends one, and the voyage
// (status, destination, ETA, draught) along the bottom. AIS says nothing
// about pitch or roll, so the horizon is level.

interface Props {
  vessel: Vessel;
  attitude?: () => { heading: number; pitch: number; roll: number } | null;
}

const BRIDGE_M = 15; // the camera's height above the water

function age(s: number | null): string {
  if (s === null) return '—';
  if (s < 90) return Math.round(s) + ' s';
  if (s < 5400) return Math.round(s / 60) + ' min';
  return Math.round(s / 3600) + ' h';
}

export default function BridgeHud({ vessel: v, attitude }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 150);
    return () => window.clearInterval(id);
  }, []);

  const att = attitude?.() ?? null;
  const hdg = att ? att.heading : (v.cog ?? v.heading ?? 0);
  const hy = horizonY(size.w, size.h, BRIDGE_M, COCKPIT_PITCH);
  const tapeW = Math.min(520, size.w - 260);
  const sog = v.sog ?? 0;
  // Heading versus course: the drift from wind and current.
  const drift = v.heading !== null && v.cog !== null ? ((v.cog - v.heading + 540) % 360) - 180 : null;

  return (
    <div ref={box} className="hud bridge" aria-label="Bridge display">
      <svg className="hud-horizon" width={size.w} height={size.h}>
        <line x1={size.w / 2 - 300} x2={size.w / 2 - 40} y1={hy} y2={hy} />
        <line x1={size.w / 2 + 40} x2={size.w / 2 + 300} y1={hy} y2={hy} />
        {/* The bow: where the camera points. */}
        <g transform={'translate(' + size.w / 2 + ',' + size.h / 2 + ')'}>
          <path d="M 0 -10 V 10 M -10 0 H 10" />
        </g>
      </svg>

      <HeadingTape hdg={hdg} width={tapeW} bug={v.cog} />

      <div className="bridge-box left">
        <small>SOG</small>
        <b className="mono">{sog.toFixed(1)}</b>
        <span>kn</span>
      </div>
      <div className="bridge-box right">
        <small>COG</small>
        <b className="mono">{v.cog !== null ? pad(v.cog, 3) + '°' : '—'}</b>
        <small>HDG</small>
        <b className="mono">{v.heading !== null ? pad(v.heading, 3) + '°' : '—'}</b>
        {drift !== null && Math.abs(drift) >= 1 && (
          <span>
            Drift {Math.abs(Math.round(drift))}° {drift > 0 ? 'stbd' : 'port'}
          </span>
        )}
      </div>

      <div className="hud-info">
        <span>{v.name || 'MMSI ' + v.mmsi}</span>
        {v.callsign && <span>{v.callsign}</span>}
        {v.status && <span>{v.status}</span>}
        {v.destination && (
          <span>
            → {v.destination}
            {v.eta ? ' · ETA ' + v.eta : ''}
          </span>
        )}
        {v.draught !== null && <span>Draught {v.draught.toFixed(1)} m</span>}
        {v.length !== null && (
          <span>
            {v.length} × {v.beam ?? '—'} m
          </span>
        )}
        <span>Report {age(v.age_s)} ago</span>
        <small>V next view · Esc exit</small>
      </div>
    </div>
  );
}
