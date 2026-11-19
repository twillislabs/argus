import { useEffect, useState } from 'react';

import { getVessel, type Vessel } from '../lib/api';
import { latLon } from '../lib/format';
import { CAMERA_MODES, type CameraMode } from '../map/aircraftCamera';
import { VESSEL_COLOR } from '../map/vesselLayer';
import { length } from '../lib/units';

const POLL_MS = 10_000;

const CATEGORY_LABEL: Record<Vessel['category'], string> = {
  cargo: 'Cargo',
  tanker: 'Tanker',
  passenger: 'Passenger',
  fishing: 'Fishing',
  military: 'Military / law enforcement',
  other: 'Other',
};

interface Props {
  mmsi: number;
  camera: CameraMode;
  onBack: () => void;
  onCamera: (mode: CameraMode) => void;
  onFly: (lat: number, lon: number) => void;
  onUpdate: (v: Vessel) => void;
}

function age(s: number | null): string {
  if (s === null) return '—';
  if (s < 90) return s + ' s ago';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  return Math.round(s / 3600) + ' h ago';
}

export default function VesselInspector({ mmsi, camera, onBack, onCamera, onFly, onUpdate }: Props) {
  const [v, setV] = useState<Vessel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setV(null);
    setError('');
    async function load() {
      try {
        const next = await getVessel(mmsi);
        if (cancelled) return;
        setV(next);
        setError('');
        onUpdate(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the vessel.');
      }
    }
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Polling depends on the MMSI only; onUpdate is stable.
  }, [mmsi]);

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      {error && !v && <p className="err pad">{error}</p>}
      {!v && !error && <p className="quiet pad">Loading…</p>}
      {v && (
        <>
          <section className="isec">
            <div className="badges">
              <span className="badge" style={{ ['--c' as string]: VESSEL_COLOR[v.category] }}>
                {CATEGORY_LABEL[v.category]}
              </span>
              {v.flag && <span className="badge">{v.flag}</span>}
              <span className="badge mono">MMSI {v.mmsi}</span>
            </div>
            <h1 className="etitle">
              <span className="acdot" style={{ background: VESSEL_COLOR[v.category] }} />
              {v.name || 'Unnamed vessel'}
            </h1>
            <div className="sub">{[v.type, v.status].filter(Boolean).join(' · ') || 'Type not reported'}</div>
            <div className="views">
              <div className="seg" role="group" aria-label="Camera view">
                {CAMERA_MODES.map((m) => (
                  <button key={m.id} aria-pressed={camera === m.id} title={m.hint} onClick={() => onCamera(m.id)}>
                    {m.id === 'cockpit' ? 'Bridge' : m.label}
                  </button>
                ))}
              </div>
              <button className="btn small" onClick={() => onFly(v.lat, v.lon)}>
                Fly to
              </button>
            </div>
            {error && <p className="quiet">Lost contact; showing the last position.</p>}
          </section>
          {(v.destination || v.eta) && (
            <section className="isec">
              <h3>Voyage</h3>
              <dl className="kv">
                <div>
                  <dt>Destination</dt>
                  <dd>{v.destination ?? '—'}</dd>
                </div>
                <div>
                  <dt>ETA (UTC)</dt>
                  <dd>{v.eta ?? '—'}</dd>
                </div>
              </dl>
              <p className="quiet small">As entered by the crew; often abbreviated or out of date.</p>
            </section>
          )}
          <section className="isec">
            <dl className="kv">
              <div>
                <dt>Speed</dt>
                <dd>{v.sog !== null ? v.sog.toFixed(1) + ' kn' : '—'}</dd>
              </div>
              <div>
                <dt>Course</dt>
                <dd>{v.cog !== null ? Math.round(v.cog) + '°' : '—'}</dd>
              </div>
              <div>
                <dt>Heading</dt>
                <dd>{v.heading !== null ? Math.round(v.heading) + '°' : '—'}</dd>
              </div>
              <div>
                <dt>Draught</dt>
                <dd>{v.draught !== null ? length(v.draught) : '—'}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{v.length ? length(v.length) + ' × ' + (v.beam ? length(v.beam) : '?') : '—'}</dd>
              </div>
              <div>
                <dt>IMO</dt>
                <dd>{v.imo ?? '—'}</dd>
              </div>
              <div>
                <dt>Callsign</dt>
                <dd>{v.callsign ?? '—'}</dd>
              </div>
              <div>
                <dt>Last position</dt>
                <dd>{age(v.age_s)}</dd>
              </div>
              <div className="wide">
                <dt>Position</dt>
                <dd>{latLon(v.lat, v.lon)}</dd>
              </div>
            </dl>
          </section>
          <section className="isec">
            <p className="quiet small">
              AIS from aisstream.io. Vessels broadcast these details themselves; they can be wrong, and some
              ships switch AIS off.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
