import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SpaceWeatherCard, { useSpaceWeather } from '../components/SpaceWeatherCard';

import AppHeader from '../components/AppHeader';
import { BAND_LABEL, Spark } from '../components/SituationPanel';
import {
  api,
  type EventItem,
  getEvents,
  getCyber,
  type ExploitedVuln,
  getSummary,
  getTension,
  getWikipedia,
  type Me,
  type SourceStatus,
  type Summary,
  type Tension,
  type WikiItem,
} from '../lib/api';
import { ago, SEVERITY_COLOR, SEVERITY_NAME, TYPE_INFO } from '../lib/format';
import { FLY_KEY } from '../lib/share';

type History = Record<string, { day: string; raw: number }[]>;


function flyToBbox(navigate: (to: string) => void, bbox: [number, number, number, number]) {
  const [w, s, e, n] = bbox;
  const span = Math.max(e - w, n - s);
  try {
    sessionStorage.setItem(FLY_KEY, JSON.stringify({ lat: (s + n) / 2, lon: (w + e) / 2, height: span * 140_000 }));
  } catch {
    // Storage blocked: the map just opens where it was.
  }
  navigate('/');
}

// Open the map on an event, selected (picked up by MapPage's applyShare).
function openEvent(navigate: (to: string) => void, e: EventItem) {
  try {
    sessionStorage.setItem(FLY_KEY, JSON.stringify({ lat: e.lat, lon: e.lon, height: 600_000, event: e.id }));
  } catch {
    // Storage blocked: the map just opens.
  }
  navigate('/');
}

function openPlace(navigate: (to: string) => void, lat: number, lon: number) {
  try {
    sessionStorage.setItem(FLY_KEY, JSON.stringify({ lat, lon, height: 600_000 }));
  } catch {
    // Storage blocked: the map just opens.
  }
  navigate('/');
}

function dtg(d: Date): string {
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z ' + mon + ' ' + String(d.getUTCFullYear()).slice(2);
}

function Delta({ v }: { v: number }) {
  return <span className={'delta ' + (v > 0 ? 'up' : v < 0 ? 'down' : '')}>{(v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v)} 24h</span>;
}

function sourceState(s: SourceStatus): 'ok' | 'warn' | 'off' {
  if (!s.enabled) return 'off';
  const ok = s.last_success_at ? Date.parse(s.last_success_at) : 0;
  if (s.last_error || Date.now() - ok > Math.max(3 * s.interval_s, 900) * 1000) return 'warn';
  return 'ok';
}

// Plain sentences on what changed since yesterday.
function changes(t: Tension | null, today: EventItem[], yesterday: EventItem[]): { color: string; text: string }[] {
  const out: { color: string; text: string }[] = [];
  if (t) {
    const w = t.world.change_24h;
    out.push({
      color: '#ff5260',
      text:
        'World tension is ' +
        t.world.level +
        ' (' +
        BAND_LABEL[t.world.band].toLowerCase() +
        ')' +
        (w ? ', ' + (w > 0 ? 'up ' : 'down ') + Math.abs(w) + ' on yesterday.' : ', unchanged on yesterday.'),
    });
    const movers = [...t.countries].filter((c) => c.change_24h).sort((a, b) => b.change_24h - a.change_24h);
    const up = movers.filter((c) => c.change_24h > 0).slice(0, 3);
    if (up.length) {
      out.push({
        color: '#ff9447',
        text: 'Rising: ' + up.map((c) => c.name + ' (+' + c.change_24h + ')').join(', ') + '.',
      });
    }
  }
  const byType = (list: EventItem[]) => {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  };
  const a = byType(today);
  const b = byType(yesterday);
  for (const type of Object.keys(TYPE_INFO) as (keyof typeof TYPE_INFO)[]) {
    const n = a.get(type) ?? 0;
    const m = b.get(type) ?? 0;
    if (!n && !m) continue;
    if (n === m) continue;
    out.push({
      color: TYPE_INFO[type].color,
      text: TYPE_INFO[type].label + ': ' + n + ' in the last 24 hours, ' + (n > m ? 'up' : 'down') + ' from ' + m + ' the day before.',
    });
  }
  return out.slice(0, 7);
}

// The daily overview (the mock-up's Brief): world and theatre tension with
// trends, what changed since yesterday, the top events and source health.
// Each theatre opens the map there.
export default function BriefPage({ me, onSignedOut }: { me: Me; onSignedOut: () => Promise<void> }) {
  const navigate = useNavigate();
  const spaceWx = useSpaceWeather();
  const [kev, setKev] = useState<ExploitedVuln[] | null>(null);
  useEffect(() => {
    getCyber()
      .then((c) => setKev(c.kev))
      .catch(() => setKev([]));
  }, []);
  const [tension, setTension] = useState<Tension | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [history, setHistory] = useState<History>({});
  const [error, setError] = useState('');
  const [wiki, setWiki] = useState<WikiItem[]>([]);
  useEffect(() => {
    getWikipedia()
      .then((r) => setWiki(r.items))
      .catch(() => setWiki([]));
  }, []);
  // The newest day with entries, grouped by Wikipedia's categories.
  const wikiDay = wiki[0]?.date ?? null;
  const wikiGroups = useMemo(() => {
    const groups = new Map<string, WikiItem[]>();
    for (const w of wiki) {
      if (w.date !== wikiDay) continue;
      const list = groups.get(w.category) ?? [];
      list.push(w);
      groups.set(w.category, list);
    }
    return [...groups];
  }, [wiki, wikiDay]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [t, s, e, h] = await Promise.all([
          getTension(),
          getSummary(),
          getEvents({ hours: 48 }),
          api<{ areas: History }>('/api/tension/history?days=14'),
        ]);
        if (cancelled) return;
        setTension(t);
        setSummary(s);
        setEvents(e.events);
        setHistory(h.areas);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the brief.');
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const dayAgo = Date.now() - 86_400_000;
  const today = useMemo(() => events.filter((e) => Date.parse(e.first_seen) >= dayAgo), [events, dayAgo]);
  const yesterday = useMemo(() => events.filter((e) => Date.parse(e.first_seen) < dayAgo), [events, dayAgo]);
  const top = useMemo(
    () =>
      [...today]
        .sort((a, b) => b.severity - a.severity || Date.parse(b.last_updated) - Date.parse(a.last_updated))
        .slice(0, 10),
    [today],
  );
  const sources = summary?.sources ?? [];
  const layers = 20;

  return (
    <div className="app">
      <AppHeader me={me} onSignedOut={onSignedOut} />
      <main className="brief">
        <div className="bhead">
          <div>
            <span className="eyebrow mono">Daily brief · {dtg(new Date())}</span>
            <h1>World situation</h1>
            <p>
              Argus combines {layers}+ layers from {sources.length} sources. Open any theatre to go to it on the map.
            </p>
          </div>
          <button className="btn" onClick={() => navigate('/')}>
            Open map
          </button>
        </div>
        {error && <p className="err">{error}</p>}

        <div className="theatres">
          {(tension?.theatres ?? []).map((t) => {
            const series = (history[t.key] ?? []).map((p) => p.raw);
            return (
              <button key={t.key} className="card theatre" onClick={() => flyToBbox(navigate, t.bbox)}>
                <b>{t.name}</b>
                <div className="trow">
                  <span className="mono tbig">{t.level}</span>
                  <Delta v={t.change_24h} />
                  <span className={'cap tband b-' + t.band}>{BAND_LABEL[t.band]}</span>
                </div>
                <Spark values={series.length > 1 ? series : [0, 0]} color={t.level >= 68 ? '#ff5260' : '#ff9447'} />
                <small>{t.top[0]?.title ?? (t.countries.length ? t.countries.slice(0, 3).join(' · ') : 'Quiet')}</small>
              </button>
            );
          })}
        </div>

        <div className="bgrid">
          <section className="card">
            <div className="ph">
              <h2>Top events · 24h</h2>
              <span className="mono">by severity</span>
            </div>
            <div className="cbody tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Sev</th>
                    <th>Event</th>
                    <th>Where</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((e) => (
                    <tr
                      key={e.id}
                      className="clickrow"
                      tabIndex={0}
                      title="Open on the map"
                      onClick={() => openEvent(navigate, e)}
                      onKeyDown={(k) => k.key === 'Enter' && openEvent(navigate, e)}
                    >
                      <td>
                        <span className="sevtag mono" style={{ color: SEVERITY_COLOR[e.severity] }}>
                          {SEVERITY_NAME[e.severity]}
                        </span>
                      </td>
                      <td>{e.title}</td>
                      <td>{e.place || e.country}</td>
                      <td className="mono">{ago(e.first_seen)}</td>
                    </tr>
                  ))}
                  {!top.length && (
                    <tr>
                      <td colSpan={4} className="quiet">
                        No events in the last 24 hours for the default layers.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="ph">
              <h2>Changes since yesterday</h2>
            </div>
            <div className="cbody">
              <ul className="digest">
                {changes(tension, today, yesterday).map((c, i) => (
                  <li key={i} style={{ ['--c' as string]: c.color }}>
                    <i />
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {wikiGroups.length > 0 && (
            <section className="card">
              <div className="ph">
                <h2>Wikipedia current events · {wikiDay}</h2>
                <a className="quiet small" href={wiki[0].url} target="_blank" rel="noreferrer noopener">
                  Portal ↗
                </a>
              </div>
              <div className="cbody wikilist">
                {wikiGroups.map(([category, items]) => (
                  <div key={category}>
                    <h3>{category}</h3>
                    <ul>
                      {items.map((w) => (
                        <li
                          key={w.id}
                          className={w.lat !== null ? 'clickrow' : undefined}
                          title={w.lat !== null ? 'Show ' + w.place + ' on the map' : undefined}
                          onClick={() => w.lat !== null && w.lon !== null && openPlace(navigate, w.lat, w.lon)}
                        >
                          {w.topics.length > 0 && <small>{w.topics[w.topics.length - 1]}</small>}
                          <span>{w.text}</span>
                          {w.sources.length > 0 && (
                            <span className="srcs">
                              {w.sources.slice(0, 3).map((src) => (
                                <a
                                  key={src.url}
                                  href={src.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {src.name || 'source'}
                                </a>
                              ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="quiet small">From Wikipedia, CC BY-SA 4.0.</p>
              </div>
            </section>
          )}

          <section className="card">
            <div className="ph">
              <h2>Exploited vulnerabilities</h2>
              <span className="mono">CISA KEV</span>
            </div>
            <div className="cbody">
              {kev === null ? (
                <p className="quiet small">Loading…</p>
              ) : kev.length === 0 ? (
                <p className="quiet small">Not fetched yet: the worker reads CISA's catalogue every six hours.</p>
              ) : (
                <ul className="kevlist">
                  {kev.slice(0, 10).map((v) => (
                    <li key={v.cve} title={v.description}>
                      <a href={'https://nvd.nist.gov/vuln/detail/' + v.cve} target="_blank" rel="noopener noreferrer">
                        <b className="mono">{v.cve}</b>
                      </a>{' '}
                      {v.vendor} {v.product}
                      {v.ransomware && <span className="badge" style={{ ['--c' as string]: '#ff7a59' }}>ransomware</span>}
                      <small>
                        {v.name} · added {v.added}
                        {v.due ? ', fix federal systems by ' + v.due : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              <p className="quiet small">
                Flaws CISA has seen exploited in the wild, newest first. Hover one for its description.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="ph">
              <h2>Space weather</h2>
              <span className="mono">NOAA SWPC</span>
            </div>
            <div className="cbody">
              <SpaceWeatherCard sw={spaceWx} alerts={6} />
            </div>
          </section>

          <section className="card">
            <div className="ph">
              <h2>Source health</h2>
              <span className="mono">collectors</span>
            </div>
            <div className="cbody tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Last pull</th>
                    <th>Items</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => {
                    const st = sourceState(s);
                    return (
                      <tr
                        key={s.name}
                        className="clickrow"
                        title={s.last_error ?? 'Open Data sources'}
                        onClick={() => navigate('/settings/sources')}
                      >
                        <td>{s.label}</td>
                        <td className="mono">{s.last_success_at ? ago(s.last_success_at) : '—'}</td>
                        <td className="mono">{s.last_count.toLocaleString()}</td>
                        <td>
                          <i className={'sdot ' + (st === 'ok' ? '' : st)} />{' '}
                          {st === 'ok' ? 'OK' : st === 'warn' ? 'Late or failing' : 'Off'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="ph">
              <h2>Tension by country</h2>
              <span className="mono">UCDP to {tension?.ucdp_through ?? '…'}</span>
            </div>
            <div className="cbody">
              <ul className="tlist">
                {(tension?.countries ?? []).slice(0, 12).map((c) => (
                  <li key={c.key} title={c.deaths_12m.toLocaleString() + ' deaths in 12 months (UCDP)'}>
                    <span className="tname">{c.name}</span>
                    <span className="tmeter">
                      <i className={'b-' + c.band} style={{ width: c.level + '%' }} />
                    </span>
                    <span className="mono tval">{c.level}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
