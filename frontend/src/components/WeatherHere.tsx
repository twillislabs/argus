import { useEffect, useState } from 'react';

import { type AirReading, type Forecast, getAirHere, getForecast, getWxAlerts, type WxAlert } from '../lib/api';
import { latLon } from '../lib/format';
import { distance, length, pressure, rainfall, skyText, temperature, windSpeed } from '../lib/units';
import { aqiBand } from '../map/airLayer';
import { alertColor } from '../map/wxLayer';

// "Weather here" (the map's right-click menu): any spot's weather now,
// the next 24 hours and the week, from Open-Meteo (no key), plus the
// NWS alerts in force there when it's in the US, and the air quality
// (Open-Meteo, CAMS).

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// Roughly the US and its territories, where api.weather.gov answers.
function inUs(lat: number, lon: number): boolean {
  return (
    (lat > 18 && lat < 72 && lon > -180 && lon < -64) ||
    (lat > 17 && lat < 19 && lon > -68 && lon < -64) ||
    (lat > 13 && lat < 21 && lon > 144 && lon < 146)
  );
}

// "14:00" from Open-Meteo's local "2026-11-20T14:00".
const hourOf = (t: string) => t.slice(11, 16);
function dayOf(t: string, i: number): string {
  if (i === 0) return 'Today';
  const d = new Date(t + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.getDate();
}

export default function WeatherHere({ lat, lon, onBack }: { lat: number; lon: number; onBack: () => void }) {
  const [fc, setFc] = useState<Forecast | null>(null);
  const [alerts, setAlerts] = useState<WxAlert[] | null>(null);
  const [air, setAir] = useState<Partial<AirReading> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFc(null);
    setAlerts(null);
    setAir(null);
    getAirHere(lat, lon)
      .then((r) => !cancelled && r.status === 'ok' && setAir(r))
      .catch(() => undefined);
    getForecast(lat, lon)
      .then((r) => !cancelled && setFc(r))
      .catch(() => !cancelled && setFc({ status: 'error' }));
    if (inUs(lat, lon))
      getWxAlerts({ lat, lon })
        .then((r) => !cancelled && setAlerts(r.local))
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  const c = fc?.current;
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">Weather here</h1>
        <div className="sub mono">
          {latLon(lat, lon)}
          {fc?.elevation_m != null ? ' · ' + length(fc.elevation_m) : ''}
          {fc?.timezone ? ' · ' + fc.timezone : ''}
        </div>
        {!fc && <p className="quiet small">Loading…</p>}
        {fc?.status === 'error' && <p className="err small">Open-Meteo didn&apos;t answer. Try again in a minute.</p>}
        {c && (
          <div className="wxnow">
            <b className="wxtemp">{c.temperature_2m != null ? temperature(c.temperature_2m) : '—'}</b>
            <span>
              {skyText(c.weather_code)}
              {c.apparent_temperature != null && <small>Feels like {temperature(c.apparent_temperature)}</small>}
            </span>
          </div>
        )}
        {c && (
          <dl className="kv">
            <div>
              <dt>Wind</dt>
              <dd>
                {c.wind_speed_10m != null ? windSpeed(c.wind_speed_10m) : '—'}
                {c.wind_direction_10m != null ? ' ' + compass(c.wind_direction_10m) : ''}
              </dd>
            </div>
            <div>
              <dt>Gusts</dt>
              <dd>{c.wind_gusts_10m != null ? windSpeed(c.wind_gusts_10m) : '—'}</dd>
            </div>
            <div>
              <dt>Humidity</dt>
              <dd>{c.relative_humidity_2m != null ? c.relative_humidity_2m + '%' : '—'}</dd>
            </div>
            <div>
              <dt>Cloud</dt>
              <dd>{c.cloud_cover != null ? c.cloud_cover + '%' : '—'}</dd>
            </div>
            <div>
              <dt>Pressure</dt>
              <dd>{c.pressure_msl != null ? pressure(c.pressure_msl) : '—'}</dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>{c.visibility != null ? distance(c.visibility / 1000) : '—'}</dd>
            </div>
          </dl>
        )}
      </section>

      {air?.us_aqi != null && (
        <section className="isec">
          <h3>Air quality</h3>
          <div className="aqnow">
            <b className="mono" style={{ color: aqiBand(air.us_aqi).color }}>
              {Math.round(air.us_aqi)}
            </b>
            <span>
              {aqiBand(air.us_aqi).label}
              <small>US AQI{air.european_aqi != null ? ' · European index ' + Math.round(air.european_aqi) : ''}</small>
            </span>
          </div>
          <dl className="kv">
            {(
              [
                ['PM2.5', air.pm2_5],
                ['PM10', air.pm10],
                ['Ozone', air.ozone],
                ['NO₂', air.nitrogen_dioxide],
              ] as const
            ).map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val != null ? Math.round(val) + ' µg/m³' : '—'}</dd>
              </div>
            ))}
          </dl>
          <p className="quiet small">Modelled (CAMS via Open-Meteo), about 40 km across; not a sensor reading.</p>
        </section>
      )}

      {alerts && alerts.length > 0 && (
        <section className="isec">
          <h3>NWS alerts here</h3>
          <ul className="wxalerts">
            {alerts.map((a) => (
              <li key={a.key}>
                <span className="acdot" style={{ background: alertColor(a) }} />
                <span>
                  <b>{a.event}</b>
                  <small>{a.expires ? 'Until ' + new Date(a.expires).toLocaleString() : a.sender}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fc?.hourly && fc.hourly.length > 0 && (
        <section className="isec">
          <h3>Next 24 hours</h3>
          <div className="wxhours">
            {fc.hourly
              .filter((_, i) => i % 2 === 0)
              .map((h) => (
                <div key={h.time} title={skyText(h.weather_code ?? undefined)}>
                  <small className="mono">{hourOf(h.time)}</small>
                  <b>{h.temperature_2m != null ? temperature(h.temperature_2m) : '—'}</b>
                  <small className={(h.precipitation_probability ?? 0) >= 50 ? 'wet' : undefined}>
                    {h.precipitation_probability != null ? h.precipitation_probability + '%' : ''}
                  </small>
                  <small>{h.wind_speed_10m != null ? windSpeed(h.wind_speed_10m) : ''}</small>
                </div>
              ))}
          </div>
        </section>
      )}

      {fc?.daily && fc.daily.length > 0 && (
        <section className="isec">
          <h3>7 days</h3>
          <ul className="wxdays">
            {fc.daily.map((d, i) => (
              <li key={d.time}>
                <span>{dayOf(d.time, i)}</span>
                <span>{skyText(d.weather_code ?? undefined)}</span>
                <span className="mono">
                  {d.temperature_2m_max != null ? temperature(d.temperature_2m_max) : '—'} /{' '}
                  {d.temperature_2m_min != null ? temperature(d.temperature_2m_min) : '—'}
                </span>
                <small className="mono">
                  {d.precipitation_probability_max != null ? d.precipitation_probability_max + '%' : ''}
                  {(d.precipitation_sum ?? 0) >= 0.25 ? ' · ' + rainfall(d.precipitation_sum ?? 0) : ''}
                  {d.wind_gusts_10m_max != null ? ' · gusts ' + windSpeed(d.wind_gusts_10m_max) : ''}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="quiet small pad">
        Forecast from Open-Meteo (national weather models). Times are local to this spot.
      </p>
    </div>
  );
}
