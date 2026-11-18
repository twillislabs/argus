import { useEffect, useState } from 'react';

import { type Aircraft, type AircraftDetail, getAircraftDetail, type RouteAirport } from '../lib/api';
import { latLon } from '../lib/format';
import { CAMERA_MODES, type CameraMode } from '../map/aircraftCamera';
import { AIR_COLOR, aircraftColor } from '../map/aircraftLayer';

const POLL_MS = 10_000;

interface Props {
  hex: string;
  camera: CameraMode;
  onBack: () => void;
  onCamera: (mode: CameraMode) => void;
  onFly: (lat: number, lon: number) => void;
  // Fresh position and server trail, for the map.
  onUpdate: (aircraft: Aircraft, trail: number[][]) => void;
}

export default function AircraftInspector({ hex, camera, onBack, onCamera, onFly, onUpdate }: Props) {
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
        onUpdate(next.aircraft, next.trail);
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
      {d && <Detail d={d} camera={camera} onCamera={onCamera} onFly={onFly} stale={Boolean(error)} />}
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
}: {
  d: AircraftDetail;
  camera: CameraMode;
  onCamera: (mode: CameraMode) => void;
  onFly: (lat: number, lon: number) => void;
  stale: boolean;
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
        <div className="views">
          <div className="seg" role="group" aria-label="Camera view">
            {CAMERA_MODES.map((m) => (
              <button
                key={m.id}
                aria-pressed={camera === m.id}
                title={m.hint}
                onClick={() => onCamera(m.id)}
              >
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
      {d.route && (
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
                {pct}% · {d.progress.remaining_km.toLocaleString()} km to go of{' '}
                {d.progress.total_km.toLocaleString()} km
              </div>
            </>
          )}
          <p className="quiet small">
            {plausible
              ? 'Planned route from adsbdb; the aircraft may divert.'
              : "The route on file doesn't match where this aircraft is, so it's probably out of date for this flight number."}
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
            <dd>{latLon(a.lat, a.lon)}</dd>
          </div>
        </dl>
      </section>
      <section className="isec">
        <p className="quiet small">
          Positions from adsb.lol (ODbL), routes and types from adsbdb. Aircraft whose owners opted out
          (PIA, LADD) aren&apos;t shown.
        </p>
      </section>
    </>
  );
}
