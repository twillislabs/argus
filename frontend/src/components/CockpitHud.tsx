import { useEffect, useRef, useState } from 'react';

import type { Aircraft, RouteAirport } from '../lib/api';
import { COCKPIT_PITCH } from '../map/aircraftCamera';

// A head-up display over the cockpit view: heading tape, speed and
// altitude tapes, vertical speed, a horizon line and the destination.
// ADS-B gives no pitch or roll, so the horizon is level and placed where
// the camera actually sees it (its downward tilt and the horizon's dip at
// this altitude).

interface Props {
  aircraft: Aircraft;
  // When the aircraft's report arrived, performance.now() milliseconds.
  reportedAt: number;
  destination: RouteAirport | null;
}

const EARTH_M = 6_371_000;
const FOV = Math.PI / 3; // Cesium's default field of view
const DEG = Math.PI / 180;

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return (2 * EARTH_M * Math.asin(Math.sqrt(a))) / 1852;
}

function pad(n: number, width: number): string {
  return String(Math.round(n)).padStart(width, '0');
}

export default function CockpitHud({ aircraft: a, reportedAt, destination }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  // Altitude climbs or descends between reports, like the aircraft does.
  const dt = Math.min(90, Math.max(0, (now - reportedAt) / 1000));
  const alt = Math.max(0, (a.alt_ft ?? 0) + ((a.vrate ?? 0) / 60) * dt);
  const hdg = a.track ?? 0;
  const gs = a.gs_kt ?? 0;
  const vs = a.vrate ?? 0;

  // Where the horizon sits on screen.
  const focal = size.w >= size.h ? size.w / 2 / Math.tan(FOV / 2) : size.h / 2 / Math.tan(FOV / 2);
  const dip = Math.acos(EARTH_M / (EARTH_M + alt * 0.3048));
  const horizonY = size.h / 2 + Math.tan(-COCKPIT_PITCH - dip) * -focal;

  const destBearing =
    destination?.lat != null && destination.lon != null
      ? bearing(a.lat, a.lon, destination.lat, destination.lon)
      : null;
  const destNm =
    destination?.lat != null && destination.lon != null
      ? distanceNm(a.lat, a.lon, destination.lat, destination.lon)
      : null;
  const eta = destNm !== null && gs > 50 ? destNm / gs : null;

  // Heading tape: 4 px per degree, centred on the track.
  const tapeW = Math.min(520, size.w - 260);
  const hdgTicks = [];
  for (let d = Math.floor(hdg - 70); d <= hdg + 70; d++) {
    if (d % 5) continue;
    const x = tapeW / 2 + (d - hdg) * (tapeW / 140);
    const deg = ((d % 360) + 360) % 360;
    const major = deg % 10 === 0;
    hdgTicks.push(
      <g key={d}>
        <line x1={x} x2={x} y1={major ? 14 : 20} y2={26} />
        {deg % 30 === 0 && (
          <text x={x} y={10}>
            {deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : pad(deg / 10, 2)}
          </text>
        )}
      </g>,
    );
  }
  const bugX =
    destBearing === null
      ? null
      : tapeW / 2 + ((((destBearing - hdg + 540) % 360) - 180) * tapeW) / 140;

  // Vertical tapes: speed (10 kt steps) and altitude (100 ft steps).
  const tapeH = Math.max(120, Math.min(260, size.h - 320));
  const tapeTop = Math.max(200, (size.h - tapeH) / 2);
  function tape(value: number, step: number, labelEvery: number, perStep: number, right: boolean) {
    const ticks = [];
    const span = Math.ceil(tapeH / 2 / perStep) + 1;
    const base = Math.round(value / step);
    for (let i = base - span; i <= base + span; i++) {
      const v = i * step;
      if (v < 0) continue;
      const y = tapeH / 2 - (v - value) * (perStep / step);
      if (y < 0 || y > tapeH) continue;
      const labelled = v % labelEvery === 0;
      ticks.push(
        <g key={i}>
          <line x1={right ? 0 : 52} x2={right ? (labelled ? 10 : 6) : labelled ? 42 : 46} y1={y} y2={y} />
          {labelled && (
            <text x={right ? 14 : 38} y={y + 4} textAnchor={right ? 'start' : 'end'}>
              {v}
            </text>
          )}
        </g>,
      );
    }
    return ticks;
  }

  return (
    <div ref={box} className="hud" aria-label="Cockpit display">
      <svg className="hud-horizon" width={size.w} height={size.h}>
        <line x1={size.w / 2 - 260} x2={size.w / 2 - 60} y1={horizonY} y2={horizonY} />
        <line x1={size.w / 2 + 60} x2={size.w / 2 + 260} y1={horizonY} y2={horizonY} />
        {/* Boresight: where the camera points. */}
        <g transform={'translate(' + size.w / 2 + ',' + size.h / 2 + ')'}>
          <path d="M -28 0 H -10 L -5 6 L 0 0 L 5 6 L 10 0 H 28" />
        </g>
      </svg>

      <svg className="hud-heading" width={tapeW} height={44} style={{ left: (size.w - tapeW) / 2 }}>
        {hdgTicks}
        {bugX !== null && bugX >= 0 && bugX <= tapeW && <path className="bug" d={'M ' + bugX + ' 26 l -6 9 h 12 z'} />}
        <path className="box" d={'M ' + (tapeW / 2 - 22) + ' 28 h 44 v 15 h -44 z'} />
        <text className="big" x={tapeW / 2} y={40}>
          {pad(hdg, 3)}
        </text>
      </svg>

      <div className="hud-tape left" style={{ top: tapeTop }}>
        <small>GS</small>
        <svg width={56} height={tapeH}>
          {tape(gs, 10, 50, 22, false)}
        </svg>
        <b className="readout">{Math.round(gs)}</b>
      </div>

      <div className="hud-tape right" style={{ top: tapeTop }}>
        <small>ALT</small>
        <svg width={64} height={tapeH}>
          {tape(alt, 100, 500, 18, true)}
        </svg>
        <b className="readout">{a.ground ? 'GND' : Math.round(alt).toLocaleString()}</b>
        <span className={'vs' + (Math.abs(vs) < 100 ? ' level' : '')}>
          {vs > 0 ? '▲' : vs < 0 ? '▼' : '■'} {Math.abs(Math.round(vs / 10) * 10).toLocaleString()} ft/min
        </span>
      </div>

      <div className="hud-info">
        <span>{a.callsign || a.reg || a.hex.toUpperCase()}</span>
        {a.squawk && <span className={a.emergency ? 'warn' : undefined}>SQK {a.squawk}</span>}
        {destination && destNm !== null && (
          <span>
            {destination.iata || destination.icao} {Math.round(destNm).toLocaleString()} NM
            {destBearing !== null ? ' · BRG ' + pad(destBearing, 3) : ''}
            {eta !== null ? ' · ETE ' + Math.floor(eta) + ':' + pad((eta % 1) * 60, 2) : ''}
          </span>
        )}
        <small>V next view · Esc exit</small>
      </div>
    </div>
  );
}
