import { useEffect, useState } from 'react';
import SpaceWeatherCard, { useSpaceWeather } from './SpaceWeatherCard';
import { PATTERN_COLOR } from '../map/patternLayer';

import type { Aircraft, Bbox, EventItem, Home, Patterns, Raids, Summary, Tension, WeatherNow, WxAlert } from '../lib/api';
import { getLiveNear } from '../lib/api';
import { aircraftColor } from '../map/aircraftLayer';
import { ago, SEVERITY_COLOR, TYPE_INFO } from '../lib/format';
import { distance, temperature, windSpeed } from '../lib/units';
import { alertColor } from '../map/wxLayer';
import VideoList from './VideoList';

interface Props {
  summary: Summary | null;
  events: EventItem[];
  home: Home | null;
  onSelect: (id: string) => void;
  aircraft: Aircraft[];
  onSelectAircraft: (hex: string) => void;
  tension: Tension | null;
  // The area on screen when zoomed in; events there are listed.
  view: Bbox | null;
  kpis: Kpis;
  weatherNow: WeatherNow | null;
  homeAlerts: WxAlert[];
  patterns: Patterns | null;
  onSelectVessel: (mmsi: number) => void;
  raids: Raids | null;
  onFlyTo: (lat: number, lon: number) => void;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function FeedItem({ e, onSelect, extra }: { e: EventItem; onSelect: (id: string) => void; extra?: string }) {
  return (
    <li>
      <button className="fi" style={{ ['--c' as string]: SEVERITY_COLOR[e.severity] }} onClick={() => onSelect(e.id)}>
        <span className="bar" />
        <span className="fbody">
          <span className="t">{e.title}</span>
          <span className="m">
            {TYPE_INFO[e.type].label}
            {e.status === 'candidate' ? ' · unconfirmed' : ''}
          </span>
        </span>
        <span className="ago mono">{extra ?? ago(e.last_updated)}</span>
      </button>
    </li>
  );
}

export const BAND_LABEL = {
  calm: 'Calm',
  stable: 'Stable',
  moderate: 'Moderate',
  high: 'High tension',
  extreme: 'Extreme',
} as const;

function Delta({ v }: { v: number }) {
  if (!v) return <span className="tdelta mono">±0 24h</span>;
  return (
    <span className={'tdelta mono ' + (v > 0 ? 'up' : 'down')}>
      {v > 0 ? '▲ ' : '▼ '}
      {Math.abs(v)} 24h
    </span>
  );
}

// World tension, as in the mock-up: the score out of 100 with its band,
// change over 24 hours and a bar from calm to severe.
export function TensionGauge({ tension }: { tension: Tension | null }) {
  if (!tension) return null;
  const w = tension.world;
  return (
    <div
      className="gauge"
      title={
        'World tension: organised violence in the 40 most affected countries (UCDP to ' +
        tension.ucdp_through +
        ') plus live events'
      }
    >
      <div className="big mono">
        {w.level}
        <small>/100</small>
      </div>
      <div className="gside">
        <div className="grow">
          <span className={'cap tband b-' + w.band}>{BAND_LABEL[w.band]}</span>
          <Delta v={w.change_24h} />
        </div>
        <div className="gbar">
          <i style={{ left: w.level + '%' }} />
        </div>
      </div>
    </div>
  );
}

// The countries furthest above their own normal.
export function TensionCountries({ tension, limit = 5 }: { tension: Tension | null; limit?: number }) {
  if (!tension || !tension.countries.length) return null;
  return (
    <section className="isec">
      <h3>Tension by country</h3>
      <ul className="tlist">
        {tension.countries.slice(0, limit).map((c) => (
          <li
            key={c.key}
            title={[
              c.deaths_12m.toLocaleString() + ' deaths in 12 months (UCDP)',
              c.vs_normal !== null
                ? 'Live activity ' + (c.vs_normal >= 0 ? '+' : '') + c.vs_normal + '% vs normal'
                : '',
              ...c.top.map((t) => t.title),
            ]
              .filter(Boolean)
              .join('\n')}
          >
            <span className="tname">{c.name}</span>
            <span className="tmeter">
              <i className={'b-' + c.band} style={{ width: c.level + '%' }} />
            </span>
            <span className="mono tval">{c.level}</span>
          </li>
        ))}
      </ul>
      <p className="quiet small">
        Organised violence over the last year (UCDP, CC BY 4.0, to {tension.ucdp_through}), moved up to 20 points by
        confirmed live events.
      </p>
    </section>
  );
}

// A small line-and-area chart of recent values.
export function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg className="spark" aria-hidden="true" />;
  const w = 160;
  const h = 22;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [1 + (i / (values.length - 1)) * (w - 4), h - 2 - ((v - lo) / span) * (h - 5)]);
  const line = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + h + ' L1 ' + h + ' Z';
  return (
    <svg className="spark" viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} fillOpacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Samples of a number while the page is open: at most one a minute, the
// last 30, for sparklines of things Argus doesn't keep history for.
function useSamples(value: number | null): number[] {
  const [samples, setSamples] = useState<{ t: number; v: number }[]>([]);
  useEffect(() => {
    if (value === null) return;
    setSamples((prev) => {
      const now = Date.now();
      const last = prev[prev.length - 1];
      if (last && now - last.t < 60_000) return [...prev.slice(0, -1), { t: last.t, v: value }];
      return [...prev, { t: now, v: value }].slice(-30);
    });
  }, [value]);
  return samples.map((x) => x.v);
}

function Tile({
  label,
  value,
  delta,
  spark,
  color,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  spark: number[];
  color: string;
}) {
  return (
    <div className="tile">
      <small>{label}</small>
      <div className="row">
        <span className="mono">{value}</span>
        {delta ? (
          <span className={'delta ' + (delta > 0 ? 'up' : 'down')}>{(delta > 0 ? '+' : '') + delta}</span>
        ) : null}
      </div>
      <Spark values={spark} color={color} />
    </div>
  );
}

// Events per hour over the last 24 hours, oldest first.
function hourly(events: EventItem[]): number[] {
  const now = Date.now();
  const out = new Array<number>(24).fill(0);
  for (const e of events) {
    const h = Math.floor((now - Date.parse(e.first_seen)) / 3_600_000);
    if (h >= 0 && h < 24) out[23 - h] += 1;
  }
  return out;
}

// "Last 60 minutes": plain sentences from what changed in the past hour.
function digest(events: EventItem[], kpis: Kpis): { color: string; text: string }[] {
  const hourAgo = Date.now() - 3_600_000;
  const recent = events.filter((e) => Date.parse(e.first_seen) >= hourAgo);
  const out: { color: string; text: string }[] = [];
  const byType = new Map<string, EventItem[]>();
  for (const e of recent) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  for (const [type, list] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3)) {
    const info = TYPE_INFO[type as keyof typeof TYPE_INFO];
    const top = [...list].sort((a, b) => b.severity - a.severity)[0];
    const where = [...new Set(list.map((e) => e.country).filter(Boolean))].slice(0, 2).join(' and ');
    out.push({
      color: info.color,
      text:
        list.length === 1
          ? info.label + ': ' + top.title + '.'
          : list.length +
            ' new ' +
            info.label.toLowerCase() +
            ' reports' +
            (where ? ', in ' + where : '') +
            '. Most severe: ' +
            top.title +
            '.',
    });
  }
  if (kpis.military) {
    out.push({
      color: '#8cc8ff',
      text:
        kpis.military +
        ' military aircraft tracked' +
        (kpis.tankers ? ', ' + kpis.tankers + ' of them tankers' : '') +
        '.',
    });
  }
  if (kpis.gps) {
    out.push({ color: '#ff6ba1', text: kpis.gps + ' areas with GPS interference in the last hour.' });
  }
  return out;
}

export interface Kpis {
  military: number;
  tankers: number;
  vessels: number | null;
  gps: number;
}

function dtg(d: Date): string {
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  return (
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0') +
    'Z ' +
    mon +
    ' ' +
    String(d.getUTCFullYear()).slice(2)
  );
}

// WMO weather codes (Open-Meteo) in a few words.
function skyText(code: number | undefined): string {
  if (code === undefined) return '';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

function inBox(b: Bbox, lat: number, lon: number): boolean {
  const [w, s, e, n] = b;
  if (lat < s || lat > n) return false;
  return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
}

export default function SituationPanel({
  summary,
  events,
  home,
  onSelect,
  aircraft,
  onSelectAircraft,
  tension,
  view,
  kpis,
  weatherNow,
  homeAlerts,
  patterns,
  onSelectVessel,
  raids,
  onFlyTo,
}: Props) {
  const spaceWx = useSpaceWeather();
  const milSpark = useSamples(kpis.military);
  const seaSpark = useSamples(kpis.vessels);
  const gpsSpark = useSamples(kpis.gps);
  const perHour = hourly(events);
  const lastHour = digest(events, kpis);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // Events in the area on screen: most severe first, then newest.
  const inView = view
    ? events
        .filter((e) => inBox(view, e.lat, e.lon))
        .sort((a, b) => b.severity - a.severity || Date.parse(b.last_updated) - Date.parse(a.last_updated))
    : [];
  const latest = [...events].sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated)).slice(0, 40);
  const near = home
    ? events
        .map((e) => ({ e, km: distanceKm(home.lat, home.lon, e.lat, e.lon) }))
        .filter((x) => x.km <= home.radius_km)
        .sort((a, b) => a.km - b.km)
    : [];
  // Contacts: aircraft within the home radius, military first, then nearest.
  const contacts = home
    ? aircraft
        .map((a) => ({ a, km: distanceKm(home.lat, home.lon, a.lat, a.lon) }))
        .filter((x) => x.km <= home.radius_km)
        .sort(
          (x, y) => Number(y.a.mil) - Number(x.a.mil) || Number(y.a.emergency) - Number(x.a.emergency) || x.km - y.km,
        )
    : [];
  const military = contacts.filter((x) => x.a.mil).length;
  const sources = summary?.sources ?? [];
  return (
    <div className="inspector-body">
      <div className="ph">
        <h2>Situation</h2>
        <span className="mono">{dtg(now)}</span>
      </div>
      <section className="isec">
        <TensionGauge tension={tension} />
        <div className="tiles">
          <Tile
            label={'Events · ' + (summary?.hours ?? 24) + 'h'}
            value={summary?.total ?? '—'}
            delta={perHour[23] || null}
            spark={perHour}
            color="#ff5260"
          />
          <Tile label="Military aircraft" value={kpis.military} spark={milSpark} color="#8cc8ff" />
          <Tile label="Vessels in view" value={kpis.vessels ?? '—'} spark={seaSpark} color="#4fc1b0" />
          <Tile label="GPS interference cells" value={kpis.gps} spark={gpsSpark} color="#ff6ba1" />
        </div>
      </section>
      {lastHour.length > 0 && (
        <section className="isec">
          <h3>Last 60 minutes</h3>
          <ul className="digest">
            {lastHour.map((d, i) => (
              <li key={i} style={{ ['--c' as string]: d.color }}>
                <i />
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view && (
        <section className="isec">
          <h3>In view · {inView.length}</h3>
          {inView.length ? (
            <ul className="feed">
              {inView.slice(0, 6).map((e) => (
                <FeedItem key={e.id} e={e} onSelect={onSelect} />
              ))}
            </ul>
          ) : (
            <p className="quiet">No events in this area for the layers and time window shown.</p>
          )}
        </section>
      )}
      {view && (
        <section className="isec">
          <h3>Live near the view</h3>
          <VideoList
            resetKey={view.map((v) => v.toFixed(1)).join(',')}
            label="Find live streams here"
            empty="No live streams tagged with a place in this area right now."
            fetch={() => {
              const [w, s, e, n] = view;
              const lat = (s + n) / 2;
              const radius = Math.min(
                250,
                Math.hypot(((e - w) / 2) * 111 * Math.cos((lat * Math.PI) / 180), ((n - s) / 2) * 111),
              );
              return getLiveNear(lat, (w + e) / 2, Math.max(10, radius));
            }}
          />
        </section>
      )}
      {home && (weatherNow?.status === 'ok' || homeAlerts.length > 0) && (
        <section className="isec">
          <h3>Weather at home · {home.name}</h3>
          {weatherNow?.status === 'ok' && weatherNow.current && (
            <>
              <div className="tiles wxtiles">
                <div className="tile">
                  <small>Now</small>
                  <span className="mono">
                    {weatherNow.current.temperature_2m != null ? temperature(weatherNow.current.temperature_2m) : '—'}
                  </span>
                </div>
                <div className="tile">
                  <small>High / low</small>
                  <span className="mono">
                    {weatherNow.high_c != null ? temperature(weatherNow.high_c) : '—'} /{' '}
                    {weatherNow.low_c != null ? temperature(weatherNow.low_c) : '—'}
                  </span>
                </div>
                <div className="tile">
                  <small>Wind · gusts</small>
                  <span className="mono">
                    {weatherNow.current.wind_speed_10m != null ? windSpeed(weatherNow.current.wind_speed_10m) : '—'}
                    {weatherNow.current.wind_gusts_10m != null
                      ? ' · ' + windSpeed(weatherNow.current.wind_gusts_10m)
                      : ''}
                  </span>
                </div>
                <div className="tile">
                  <small>Rain chance</small>
                  <span className="mono">{weatherNow.rain_chance != null ? weatherNow.rain_chance + '%' : '—'}</span>
                </div>
              </div>
              <p className="quiet small">Open-Meteo · {skyText(weatherNow.current.weather_code)}</p>
            </>
          )}
          {homeAlerts.length > 0 ? (
            <ul className="feed">
              {homeAlerts.slice(0, 5).map((a) => (
                <li key={a.key}>
                  <a
                    className="fi"
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ['--c' as string]: alertColor(a), textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className="bar" />
                    <span className="fbody">
                      <span className="t">{a.event}</span>
                      <span className="m">{a.sender}</span>
                    </span>
                    <span className="ago mono">
                      {a.expires
                        ? 'until ' + new Date(a.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet small">No NWS warnings, watches or advisories for home right now.</p>
          )}
        </section>
      )}
      {home && (
        <section className="isec">
          <h3>
            Near home · {home.name} · {distance(home.radius_km)}
          </h3>
          {near.length ? (
            <ul className="feed">
              {near.slice(0, 5).map(({ e, km }) => (
                <FeedItem key={e.id} e={e} onSelect={onSelect} extra={distance(km)} />
              ))}
            </ul>
          ) : (
            <p className="quiet">Nothing within {distance(home.radius_km)} in this time window.</p>
          )}
        </section>
      )}
      {home && (
        <section className="isec">
          <h3>
            Aircraft near home · {contacts.length}
            {military ? ' · ' + military + ' military' : ''}
          </h3>
          {contacts.length ? (
            <ul className="contacts">
              {contacts.slice(0, 8).map(({ a, km }) => (
                <li key={a.hex}>
                  <button onClick={() => onSelectAircraft(a.hex)}>
                    <i className="acdot" style={{ background: aircraftColor(a) }} />
                    <span className="cname">
                      <b className="mono">{a.callsign || a.reg || a.hex.toUpperCase()}</b>
                      <small>
                        {[a.mil ? a.role : null, a.type, a.emergency ? 'SQK ' + a.squawk : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                    <span className="mono cmeta">
                      {a.ground ? 'GND' : a.alt_ft !== null ? Math.round(a.alt_ft / 100) * 100 + ' ft' : '—'}
                      <br />
                      {distance(km)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet">
              No aircraft within {distance(home.radius_km)} on the map. Civil traffic loads when the map shows your
              region.
            </p>
          )}
        </section>
      )}
      {raids && <RaidSection raids={raids} onFlyTo={onFlyTo} />}
      {patterns && patterns.air.length + patterns.sea.length > 0 && (
        <section className="isec">
          <h3>Patterns · {patterns.air.length + patterns.sea.length}</h3>
          <ul className="patlist">
            {patterns.air.map((p) => (
              <li key={'a' + p.hex}>
                <button onClick={() => onSelectAircraft(p.hex)}>
                  <b style={{ color: PATTERN_COLOR.air }}>{p.kind === 'racetrack' ? 'Racetrack' : 'Orbit'}</b>{' '}
                  {p.callsign || p.hex.toUpperCase()}
                  {p.type ? ' · ' + p.type : ''}
                  {p.role ? ' (' + p.role + ')' : ''}
                  <small>
                    {p.laps} laps in {p.minutes} min, {distance(p.radius_km * 2)} across
                    {p.near ? ' · near ' + p.near : ''}
                  </small>
                </button>
              </li>
            ))}
            {patterns.sea.map((p) => (
              <li key={'s' + p.mmsi}>
                <button onClick={() => onSelectVessel(p.mmsi)}>
                  <b style={{ color: PATTERN_COLOR.sea }}>Loitering on a cable</b> {p.name || 'MMSI ' + p.mmsi}
                  <small>
                    {p.hours} h within 3 km, {distance(p.cable_km)} from {p.cable}
                    {p.status ? ' · ' + p.status : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <p className="quiet small">Indicators, not conclusions: aircraft train in circuits and ships wait out weather.</p>
        </section>
      )}
      <TensionCountries tension={tension} />
      <section className="isec">
        <h3>Space weather</h3>
        <SpaceWeatherCard sw={spaceWx} />
      </section>
      <section className="isec">
        <h3>Live feed · {events.length}</h3>
        {latest.length ? (
          <ul className="feed">
            {latest.map((e) => (
              <FeedItem key={e.id} e={e} onSelect={onSelect} />
            ))}
          </ul>
        ) : (
          <p className="quiet">
            No events yet. The worker fetches USGS every minute and GDELT every 5 minutes; the first results appear
            shortly after it starts.
          </p>
        )}
      </section>
      <section className="isec">
        <h3>Headlines</h3>
        {summary?.news.length ? (
          <ul className="news">
            {summary.news.slice(0, 12).map((a) => (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.title}
                </a>
                <span className="m">
                  {a.outlet} · {ago(a.published_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">No headlines yet.</p>
        )}
      </section>
      <section className="isec">
        <h3>Sources</h3>
        <ul className="sources">
          {sources.map((s) => (
            <li key={s.name} title={s.last_error ?? undefined}>
              <i className={'sdot ' + (!s.enabled ? 'off' : s.last_error ? 'warn' : 'ok')} />
              <span>{s.label}</span>
              <span className="mono">
                {!s.enabled ? 'off' : s.last_success_at ? ago(s.last_success_at) : 'waiting'}
              </span>
            </li>
          ))}
          {sources.length === 0 && <li className="quiet">The worker hasn't reported yet.</li>}
        </ul>
      </section>
    </div>
  );
}

// Air-raid alerts: Ukraine's oblasts under alert now (continuous ones in
// occupied areas apart), and Israel's alerts of the last 24 hours.
function RaidSection({ raids, onFlyTo }: { raids: Raids; onFlyTo: (lat: number, lon: number) => void }) {
  const ua = raids.ukraine.filter((a) => a.active && !a.long_running);
  const uaLong = raids.ukraine.filter((a) => a.active && a.long_running);
  const ilNow = raids.israel.filter((a) => a.active);
  const ilRecent = raids.israel.filter((a) => !a.active);
  return (
    <section className="isec">
      <h3>Air-raid alerts</h3>
      <div className="raidrow">
        <b>Ukraine</b>
        {ua.length ? (
          <span>
            {ua.length} oblast{ua.length === 1 ? '' : 's'} under alert:{' '}
            {ua.map((a, i) => (
              <span key={a.id}>
                {i ? ', ' : ''}
                <button className="linkish" onClick={() => onFlyTo(a.lat, a.lon)}>
                  {a.name.replace(/ Oblast$/, '')}
                </button>
              </span>
            ))}
          </span>
        ) : (
          <span className="quiet">No alerts now</span>
        )}
        {uaLong.length > 0 && (
          <small className="quiet">
            Continuous since 2022 in occupied areas: {uaLong.map((a) => a.name.replace(/ Oblast$/, '')).join(', ')}
          </small>
        )}
      </div>
      <div className="raidrow">
        <b>Israel</b>
        {ilNow.length ? (
          <span className="crit">
            Sounding now in {ilNow.length} place{ilNow.length === 1 ? '' : 's'}:{' '}
            {[...new Set(ilNow.map((a) => a.name))].slice(0, 6).join(', ')}
          </span>
        ) : (
          <span className="quiet">No alerts now</span>
        )}
        {ilRecent.length > 0 && (
          <small className="quiet">
            Last 24 h: {ilRecent.length} alert{ilRecent.length === 1 ? '' : 's'}, latest{' '}
            {ilRecent[0].threat_label?.toLowerCase()} in {ilRecent[0].name}, {ago(ilRecent[0].time ?? null)}
          </small>
        )}
      </div>
      {(raids.ukraine_status === 'error' || raids.israel_status === 'error') && (
        <p className="quiet small">One of the alert feeds didn&apos;t answer.</p>
      )}
    </section>
  );
}
