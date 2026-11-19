import { useEffect, useState } from 'react';

import { ago } from '../lib/format';
import { getSpaceWeather, kpColor, SCALE_COLOR, type SpaceWeather } from '../lib/spaceweather';

// Space weather for the Situation panel and the Brief: NOAA's three
// scales now, the Kp index (last 24 hours), the next days' outlook and
// the latest alerts. Refreshed every ten minutes (the API caches it).

const WHY: Record<'R' | 'S' | 'G', string> = {
  R: 'HF radio and GPS on the day side',
  S: 'polar flights, satellites, HF in the polar regions',
  G: 'power grids, satellites, GPS, HF; auroras',
};

export function useSpaceWeather(): SpaceWeather | null {
  const [sw, setSw] = useState<SpaceWeather | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getSpaceWeather()
        .then((r) => !cancelled && setSw(r))
        .catch(() => !cancelled && setSw({ status: 'error' }));
    void load();
    const id = window.setInterval(load, 600_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return sw;
}

export default function SpaceWeatherCard({ sw, alerts = 3 }: { sw: SpaceWeather | null; alerts?: number }) {
  if (!sw) return <p className="quiet small">Loading…</p>;
  if (sw.status === 'error' || !sw.now)
    return <p className="quiet small">NOAA's space weather service didn't answer.</p>;
  const kp = sw.kp;
  return (
    <div className="spacewx">
      <div className="swscales">
        {(['R', 'S', 'G'] as const).map((k) => {
          const s = sw.now?.[k];
          if (!s) return null;
          return (
            <div key={k} className="swscale" title={s.name + ': affects ' + WHY[k]}>
              <b style={{ background: SCALE_COLOR[s.scale] }}>
                {k}
                {s.scale}
              </b>
              <span>
                {s.name}
                <small>{s.scale ? s.text : 'none'}</small>
              </span>
            </div>
          );
        })}
      </div>
      {kp && kp.now !== null && (
        <div className="swkp">
          <span>
            Kp <b style={kp.now >= 5 ? { color: kpColor(kp.now) } : undefined}>{kp.now.toFixed(1)}</b>
            <small> · 24 h high {kp.max_24h?.toFixed(1)}</small>
          </span>
          <span className="swbars" aria-label="Kp, last 24 hours">
            {kp.recent.map((p) => (
              <i
                key={p.at}
                title={p.at.replace('T', ' ').slice(0, 16) + ' UTC · Kp ' + p.kp.toFixed(1)}
                style={{ height: Math.max(2, (p.kp / 9) * 100) + '%', background: kpColor(p.kp) }}
              />
            ))}
          </span>
        </div>
      )}
      {sw.forecast && sw.forecast.length > 0 && (
        <p className="quiet small">
          Outlook:{' '}
          {sw.forecast
            .map(
              (f) =>
                new Date(f.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short' }) +
                ' R1+ ' +
                (f.r_minor_pct ?? 0) +
                '%' +
                (f.g_scale ? ', G' + f.g_scale : ''),
            )
            .join(' · ')}
        </p>
      )}
      {sw.alerts && sw.alerts.length > 0 && (
        <ul className="swalerts">
          {sw.alerts.slice(0, alerts).map((a) => (
            <li key={a.id + a.issued} title={a.message}>
              <b>{a.kind}</b> {a.headline}
              <small> · {ago(a.issued)}</small>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet small">
        NOAA Space Weather Prediction Center
        {sw.status === 'stale' ? ' (the latest check failed; may be out of date)' : ''}.
      </p>
    </div>
  );
}
