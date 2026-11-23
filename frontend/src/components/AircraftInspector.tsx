import { useEffect, useState } from 'react';

import { type Aircraft, type AircraftDetail, type AirPattern, getAircraftDetail, type RouteAirport } from '../lib/api';
import { airPatternLine } from '../lib/patterns';
import { PATTERN_COLOR } from '../map/patternLayer';
import { CAMERA_MODES, type CameraMode } from '../map/aircraftCamera';
import { AIR_COLOR, aircraftColor } from '../map/aircraftLayer';
import { distance } from '../lib/units';
import CopyCoords from './CopyCoords';

const POLL_MS = 10_000;
// Route databases, by the backend's leg "source".
const ROUTE_SOURCE: Record<string, string> = {
  adsbdb: 'adsbdb',
  vrs: 'Virtual Radar Server',
  hexdb: 'hexdb',
};

interface Props {
  hex: string;
  camera: CameraMode;
  onBack: () => void;
  onCamera: (mode: CameraMode) => void;
  onFly: (lat: number, lon: number) => void;
  // Fresh position, server trail and route, for the map.
  onUpdate: (aircraft: Aircraft, trail: number[][], detail: AircraftDetail) => void;
  // The planned route drawn on the map, flown part solid.
  showRoute: boolean;
  onShowRoute: (on: boolean) => void;
  // The orbit or racetrack it's flying (Patterns), if any.
  pattern?: AirPattern | null;
}

export default function AircraftInspector({
  hex,
  camera,
  onBack,
  onCamera,
  onFly,
  onUpdate,
  showRoute,
  onShowRoute,
  pattern,
}: Props) {
  const [d, setD] = useState<AircraftDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setD(null);
    setError('');
    async function load() {
      try {
        const next = await getAircraftDetail(hex);
        if (cancelled) return;
        setD(next);
        setError('');
        onUpdate(next.aircraft, next.trail, next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the aircraft.');
      }
    }
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Polling depends on hex only; onUpdate is stable (useCallback).
  }, [hex]);

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      {error && !d && <p className="err pad">{error}</p>}
      {!d && !error && <p className="quiet pad">Loading…</p>}
      {d && (
        <Detail
          d={d}
          camera={camera}
          onCamera={onCamera}
          onFly={onFly}
          stale={Boolean(error)}
          showRoute={showRoute}
          pattern={pattern}
          onShowRoute={onShowRoute}
        />
      )}
    </div>
  );
}

function airportLine(a: RouteAirport | null): { code: string; name: string } {
  if (!a) return { code: '—', name: 'Unknown' };
  return { code: a.iata || a.icao || '—', name: a.city || a.name || '' };
}

function Detail({
  d,
  camera,
  onCamera,
  onFly,
  stale,
  showRoute,
  onShowRoute,
  pattern,
}: {
  d: AircraftDetail;
  camera: CameraMode;
  onCamera: (mode: CameraMode) => void;
  onFly: (lat: number, lon: number) => void;
  stale: boolean;
  showRoute: boolean;
  onShowRoute: (on: boolean) => void;
  pattern?: AirPattern | null;
}) {
  const a = d.aircraft;
  const title = d.route?.flight || a.callsign || a.reg || a.hex.toUpperCase();
  const typeName = [d.detail?.manufacturer, d.detail?.type].filter(Boolean).join(' ') || a.type;
  const from = airportLine(d.route?.origin ?? null);
  const to = airportLine(d.route?.destination ?? null);
  const plausible = d.progress?.plausible !== false;
  const pct = d.progress && plausible ? Math.round(d.progress.fraction * 100) : null;
  return (
    <>
      <section className="isec">
        <div className="badges">
          {a.mil ? (
            <span className="badge" style={{ ['--c' as string]: AIR_COLOR.military }}>
              Military{a.role && a.role !== 'Military' ? ' · ' + a.role : ''}
            </span>
          ) : (
            <span className="badge">Civil</span>
          )}
          {a.emergency && (
            <span className="badge" style={{ ['--c' as string]: AIR_COLOR.emergency }}>
              Squawk {a.squawk ?? 'emergency'}
            </span>
          )}
          {a.ground && <span className="badge">On the ground</span>}
          <span className="badge mono">{a.hex.toUpperCase()}</span>
        </div>
        <h1 className="etitle">
          <span className="acdot" style={{ background: aircraftColor(a) }} />
          {title}
        </h1>
        <div className="sub">
          {[d.route?.airline, typeName, a.reg].filter(Boolean).join(' · ') || 'Unknown aircraft'}
        </div>
        {pattern && (
          <p className="patline small">
            <b style={{ color: PATTERN_COLOR.air }}>Flying {pattern.kind === 'orbit' ? 'an orbit' : 'a racetrack'}</b>
            {' · '}
            {airPatternLine(pattern)}
          </p>
        )}
        <div className="views">
          <div className="seg" role="group" aria-label="Camera view">
            {CAMERA_MODES.map((m) => (
              <button key={m.id} aria-pressed={camera === m.id} title={m.hint} onClick={() => onCamera(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <button className="btn small" onClick={() => onFly(a.lat, a.lon)}>
            Fly to
          </button>
        </div>
        {stale && <p className="quiet">Lost contact; showing the last position.</p>}
      </section>
      {d.route && !plausible && (
        <section className="isec">
          <h3>Route</h3>
          <p>Unknown for this flight.</p>
          <p className="quiet small">
            The route databases have {from.code} → {to.code} for {d.route.callsign}, but this aircraft isn&apos;t flying
            it: airlines reuse flight numbers for different legs, and the databases can lag behind.
          </p>
        </section>
      )}
      {d.route && plausible && (
        <section className="isec">
          <h3>Route</h3>
          <div className="route">
            <div>
              <b className="mono">{from.code}</b>
              <small>{from.name}</small>
            </div>
            <span className="arrow">→</span>
            <div className="end">
              <b className="mono">{to.code}</b>
              <small>{to.name}</small>
            </div>
          </div>
          {pct !== null && d.progress && (
            <>
              <div className="meter route-meter" aria-label={pct + '% flown'}>
                <i style={{ width: pct + '%', background: AIR_COLOR.military }} />
              </div>
              <div className="sub mono">
                {pct}% · {distance(d.progress.remaining_km)} to go of {distance(d.progress.total_km)}
              </div>
            </>
          )}
          {plausible && (
            <div className="actions" style={{ marginTop: 6 }}>
              <button
                className={'btn small' + (showRoute ? ' on' : '')}
                aria-pressed={showRoute}
                onClick={() => onShowRoute(!showRoute)}
              >
                {showRoute ? 'Hide route on map' : 'Show route on map'}
              </button>
            </div>
          )}
          <p className="quiet small">
            Planned route from {ROUTE_SOURCE[d.route.source ?? ''] ?? 'adsbdb'}, matched to where the aircraft is; it
            may divert.
          </p>
        </section>
      )}
      <section className="isec">
        <dl className="kv">
          <div>
            <dt>Altitude</dt>
            <dd>{a.ground ? 'Ground' : a.alt_ft !== null ? a.alt_ft.toLocaleString() + ' ft' : '—'}</dd>
          </div>
          <div>
            <dt>Ground speed</dt>
            <dd>{a.gs_kt !== null ? Math.round(a.gs_kt) + ' kt' : '—'}</dd>
          </div>
          <div>
            <dt>Track</dt>
            <dd>{a.track !== null ? Math.round(a.track) + '°' : '—'}</dd>
          </div>
          <div>
            <dt>Vertical rate</dt>
            <dd>{a.vrate !== null ? (a.vrate > 0 ? '+' : '') + a.vrate + ' ft/min' : '—'}</dd>
          </div>
          <div>
            <dt>Squawk</dt>
            <dd>{a.squawk ?? '—'}</dd>
          </div>
          <div>
            <dt>Callsign</dt>
            <dd>{a.callsign || '—'}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{a.type || '—'}</dd>
          </div>
          <div>
            <dt>Registered in</dt>
            <dd>{d.detail?.country ?? '—'}</dd>
          </div>
          <div className="wide">
            <dt>Position</dt>
            <dd>
              <CopyCoords lat={a.lat} lon={a.lon} />
            </dd>
          </div>
        </dl>
      </section>
      <section className="isec">
        <p className="quiet small">
          Positions from {a.source ?? 'adsb.lol'}
          {a.source === 'adsb.fi' ? '' : ' (ODbL)'}, routes from adsbdb, Virtual Radar Server (CC0, via adsb.lol) and
          hexdb, types from adsbdb. Aircraft whose owners opted out (PIA, LADD) aren&apos;t shown.
        </p>
      </section>
    </>
  );
}
