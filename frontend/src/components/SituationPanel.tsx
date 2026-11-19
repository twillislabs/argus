import type { Aircraft, Bbox, EventItem, Home, Summary, Tension } from '../lib/api';
import { aircraftColor } from '../map/aircraftLayer';
import { ago, EVENT_TYPES, SEVERITY_COLOR, TYPE_INFO } from '../lib/format';

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

const BAND_LABEL = { normal: 'Normal', elevated: 'Elevated', high: 'High', severe: 'Severe' } as const;

function Delta({ v }: { v: number }) {
  if (!v) return <span className="tdelta mono">±0 24h</span>;
  return (
    <span className={'tdelta mono ' + (v > 0 ? 'up' : 'down')}>
      {v > 0 ? '▲ ' : '▼ '}
      {Math.abs(v)} 24h
    </span>
  );
}

// World tension: the index for the world, then the countries furthest
// above their own normal.
export function TensionSection({ tension }: { tension: Tension | null }) {
  if (!tension) return null;
  const w = tension.world;
  return (
    <section className="isec">
      <h3>World tension</h3>
      <div className="tgauge">
        <span className="mono tnum">{w.level}</span>
        <span className={'tband b-' + w.band}>{BAND_LABEL[w.band]}</span>
        <Delta v={w.change_24h} />
      </div>
      <div className="tbar">
        <i style={{ left: w.level + '%' }} />
      </div>
      <ul className="tlist">
        {tension.countries.slice(0, 5).map((c) => (
          <li key={c.key} title={c.top.map((t) => t.title).join('\n')}>
            <span className="tname">{c.name}</span>
            <span className="tmeter">
              <i className={'b-' + c.band} style={{ width: c.level + '%' }} />
            </span>
            <span className="mono tval">{c.level}</span>
          </li>
        ))}
      </ul>
      {!tension.baseline_ready && (
        <p className="quiet small">
          Learning what&apos;s normal: {tension.baseline_days} of 7 days of history so far. Until then each
          country is compared with what history there is, or with a typical country today.
        </p>
      )}
    </section>
  );
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
}: Props) {
  // Events in the area on screen: most severe first, then newest.
  const inView = view
    ? events
        .filter((e) => inBox(view, e.lat, e.lon))
        .sort((a, b) => b.severity - a.severity || Date.parse(b.last_updated) - Date.parse(a.last_updated))
    : [];
  const latest = [...events]
    .sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated))
    .slice(0, 40);
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
        .sort((x, y) => Number(y.a.mil) - Number(x.a.mil) || Number(y.a.emergency) - Number(x.a.emergency) || x.km - y.km)
    : [];
  const military = contacts.filter((x) => x.a.mil).length;
  const sources = summary?.sources ?? [];
  return (
    <div className="inspector-body">
      <div className="ph">
        <h2>Situation</h2>
        <span className="mono">last {summary?.hours ?? 24}h</span>
      </div>
      <TensionSection tension={tension} />
      <section className="isec">
        <div className="tiles">
          <div className="tile">
            <small>Events</small>
            <span className="mono big">{summary?.total ?? '—'}</span>
          </div>
          {EVENT_TYPES.map((t) => (
            <div className="tile" key={t}>
              <small>
                <i className="dot" style={{ background: TYPE_INFO[t].color }} /> {TYPE_INFO[t].label}
              </small>
              <span className="mono">{summary?.by_type[t] ?? 0}</span>
            </div>
          ))}
        </div>
      </section>
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
      {home && (
        <section className="isec">
          <h3>
            Near home · {home.name} · {home.radius_km} km
          </h3>
          {near.length ? (
            <ul className="feed">
              {near.slice(0, 5).map(({ e, km }) => (
                <FeedItem key={e.id} e={e} onSelect={onSelect} extra={Math.round(km) + ' km'} />
              ))}
            </ul>
          ) : (
            <p className="quiet">Nothing within {home.radius_km} km in this time window.</p>
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
                      {Math.round(km)} km
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet">
              No aircraft within {home.radius_km} km on the map. Civil traffic loads when the map shows your region.
            </p>
          )}
        </section>
      )}
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
            No events yet. The worker fetches USGS every minute and GDELT every 5 minutes;
            the first results appear shortly after it starts.
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
