import { useEffect, useState } from 'react';

import { getSatellite, type Home, type SatelliteDetail } from '../lib/api';
import { ago } from '../lib/format';
import { type OrbitInfo, type Pass, SAT_COLOR } from '../map/satellites';

const CLASS_LABEL: Record<SatelliteDetail['class'], string> = {
  leo: 'Low Earth orbit',
  meo: 'Medium Earth orbit',
  geo: 'Geosynchronous',
  heo: 'Highly elliptical',
};

const TAG_LABEL: Record<string, string> = {
  station: 'Space station',
  weather: 'Weather',
  gnss: 'Navigation (GNSS)',
  military: 'Military',
  science: 'Science',
  amateur: 'Amateur radio',
  new: 'Launched in the last 30 days',
  starlink: 'Starlink',
  oneweb: 'OneWeb',
  kuiper: 'Kuiper',
};

interface Props {
  norad: number;
  home: Home | null;
  following: boolean;
  onBack: () => void;
  onFollow: (follow: boolean) => void;
  onFly: () => void;
  orbit: (norad: number) => Promise<OrbitInfo | null>;
  passes: (norad: number, lat: number, lon: number) => Promise<Pass[]>;
}

function clock(t: number): string {
  return new Date(t).toISOString().slice(11, 16) + 'Z';
}

function when(t: number): string {
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return 'in ' + mins + ' min';
  return 'in ' + Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
}

export default function SatelliteInspector({ norad, home, following, onBack, onFollow, onFly, orbit, passes }: Props) {
  const [d, setD] = useState<SatelliteDetail | null>(null);
  const [live, setLive] = useState<OrbitInfo | null>(null);
  const [next, setNext] = useState<Pass[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setD(null);
    setNext(null);
    setError('');
    getSatellite(norad)
      .then((x) => !cancelled && setD(x))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load it.'));
    const refresh = () =>
      void orbit(norad).then((o) => {
        if (!cancelled) setLive(o);
      });
    refresh();
    const id = window.setInterval(refresh, 5000);
    if (home) {
      void passes(norad, home.lat, home.lon).then((p) => {
        if (!cancelled) setNext(p);
      });
    }
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // orbit and passes come from the globe and don't change.
  }, [norad, home?.lat, home?.lon]);

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      {error && <p className="err pad">{error}</p>}
      {!d && !error && <p className="quiet pad">Loading…</p>}
      {d && (
        <>
          <section className="isec">
            <div className="badges">
              <span className="badge" style={{ ['--c' as string]: SAT_COLOR[d.class] }}>
                {CLASS_LABEL[d.class]}
              </span>
              {d.tags.map((t) => (
                <span key={t} className="badge">
                  {TAG_LABEL[t] ?? t}
                </span>
              ))}
            </div>
            <h1 className="etitle">
              <span className="acdot" style={{ background: SAT_COLOR[d.class] }} />
              {d.name}
            </h1>
            <div className="sub mono">
              NORAD {d.norad} · {d.cospar}
            </div>
            <div className="actions">
              <button className={'btn' + (following ? ' primary' : '')} onClick={() => onFollow(!following)}>
                {following ? 'Following' : 'Follow'}
              </button>
              <button className="btn" onClick={onFly}>
                Fly to
              </button>
            </div>
          </section>
          <section className="isec">
            <dl className="kv">
              <div>
                <dt>Altitude now</dt>
                <dd>{live && Number.isFinite(live.altKm) ? Math.round(live.altKm).toLocaleString() + ' km' : '—'}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>{live && Number.isFinite(live.speedKms) ? live.speedKms.toFixed(2) + ' km/s' : '—'}</dd>
              </div>
              <div>
                <dt>Period</dt>
                <dd>{d.orbit.period_min.toLocaleString()} min</dd>
              </div>
              <div>
                <dt>Inclination</dt>
                <dd>{d.orbit.inclination}°</dd>
              </div>
              <div>
                <dt>Perigee</dt>
                <dd>{d.orbit.perigee_km.toLocaleString()} km</dd>
              </div>
              <div>
                <dt>Apogee</dt>
                <dd>{d.orbit.apogee_km.toLocaleString()} km</dd>
              </div>
              <div className="wide">
                <dt>Elements</dt>
                <dd>{ago(d.epoch)} (CelesTrak)</dd>
              </div>
            </dl>
          </section>
          <section className="isec">
            <h3>Passes over home · next 24 h</h3>
            {!home ? (
              <p className="quiet">Set a home location to see passes.</p>
            ) : next === null ? (
              <p className="quiet">Working out passes…</p>
            ) : next.length === 0 ? (
              <p className="quiet">No passes above 10° in the next 24 hours.</p>
            ) : (
              <ul className="passes">
                {next.map((p) => (
                  <li key={p.rise}>
                    <span className="mono">
                      {clock(p.rise)}–{clock(p.set)}
                    </span>
                    <span className="mono">{Math.round(p.maxEl)}° max</span>
                    <span className="dim">{when(p.rise)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="quiet small">
              Above 10° elevation from {home?.name ?? 'home'}. Elements from CelesTrak; positions by SGP4 in your
              browser.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
