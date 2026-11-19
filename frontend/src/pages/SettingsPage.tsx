import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import AccountCard from '../components/AccountCard';
import AppHeader from '../components/AppHeader';
import HomePicker from '../components/HomePicker';
import ImageryCard from '../components/ImageryCard';
import UsersCard from '../components/UsersCard';
import { CHANNELS } from '../config/newsChannels';
import {
  api,
  can,
  getKeys,
  getReceivers,
  type Home,
  type KeyState,
  type Me,
  saveKeys,
  saveReceivers,
  savePreferences,
  type SourceStatus,
} from '../lib/api';
import { ago, zuluTime } from '../lib/format';
import type { Units } from '../lib/units';

interface Props {
  me: Me;
  onSaved: () => Promise<void>;
  onSignedOut: () => Promise<void>;
}

interface Section {
  id: string;
  label: string;
  title: string;
  description: string;
  group: 'Personal' | 'Administration';
  capability?: string;
}

const SECTIONS: Section[] = [
  {
    id: 'account',
    label: 'Account',
    title: 'Account',
    description: 'Your name, email and password.',
    group: 'Personal',
  },
  {
    id: 'home',
    label: 'Home location',
    title: 'Home location',
    description: 'Where the map opens, the home clock, and the radius for "near home".',
    group: 'Personal',
  },
  {
    id: 'display',
    label: 'Display',
    title: 'Display',
    description: 'How Argus looks on this account.',
    group: 'Personal',
  },
  {
    id: 'users',
    label: 'Users & roles',
    title: 'Users and roles',
    description: 'Who can sign in, and what each person can do.',
    group: 'Administration',
    capability: 'users.manage',
  },
  {
    id: 'imagery',
    label: 'Map imagery',
    title: 'Map imagery',
    description: 'Where Satellite, Hybrid and 3D imagery comes from, for every user.',
    group: 'Administration',
    capability: 'settings.manage',
  },
  {
    id: 'sources',
    label: 'Data sources',
    title: 'Data sources',
    description: 'Keys for sources that need one, and how every source is doing.',
    group: 'Administration',
    capability: 'settings.manage',
  },
  {
    id: 'streetmap',
    label: 'Street map',
    title: 'Self-hosted street map',
    description: 'The OpenStreetMap region this server renders for the Dark map.',
    group: 'Administration',
    capability: 'settings.manage',
  },
  {
    id: 'audit',
    label: 'Audit log',
    title: 'Audit log',
    description: 'Sign-ins, account changes and setting changes, newest first.',
    group: 'Administration',
    capability: 'users.manage',
  },
];

export default function SettingsPage({ me, onSaved, onSignedOut }: Props) {
  const { section = 'account' } = useParams();
  const visible = SECTIONS.filter((s) => !s.capability || can(me.user, s.capability));
  const current = visible.find((s) => s.id === section);
  if (!current) return <Navigate to="/settings/account" replace />;

  let body: ReactNode = null;
  if (current.id === 'account') body = <AccountCard me={me} onSaved={onSaved} />;
  else if (current.id === 'home') body = <HomeSection me={me} onSaved={onSaved} />;
  else if (current.id === 'display')
    body = (
      <>
        <DisplaySection me={me} onSaved={onSaved} />
        <WallSection me={me} onSaved={onSaved} />
      </>
    );
  else if (current.id === 'users') body = <UsersCard me={me} />;
  else if (current.id === 'imagery') body = <ImageryCard />;
  else if (current.id === 'streetmap') body = <StreetMapSection />;
  else if (current.id === 'sources') body = <SourcesSection />;
  else if (current.id === 'audit') body = <AuditSection />;

  const groups = ['Personal', 'Administration'] as const;
  return (
    <div className="app">
      <AppHeader me={me} onSignedOut={onSignedOut} />
      <main className="settings">
        <nav className="snav" aria-label="Settings">
          {groups.map((g) => {
            const items = visible.filter((s) => s.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="sgroup">
                <div className="sgtitle">{g}</div>
                {items.map((s) => (
                  <Link
                    key={s.id}
                    to={'/settings/' + s.id}
                    aria-current={s.id === current.id ? 'page' : undefined}
                  >
                    {s.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="settings-body">
          <header className="shead">
            {current.group === 'Administration' && <span className="eyebrow">Administration · all users</span>}
            <h1>{current.title}</h1>
            <p>{current.description}</p>
          </header>
          <div className="spanels">{body}</div>
        </div>
      </main>
    </div>
  );
}

function HomeSection({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const current = me.preferences.home ?? null;
  const [home, setHome] = useState<Home | null>(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!home) {
      setMessage({ ok: false, text: 'Pick a place or enter valid coordinates.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await savePreferences({ home });
      await onSaved();
      setMessage({ ok: true, text: 'Saved. The map now opens at ' + home.name + '.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="ph">
        <h2>Home</h2>
        <span className="mono">{current ? current.name : 'not set'}</span>
      </div>
      <div className="cbody">
        <HomePicker value={current} onChange={setHome} />
        <div className="actions">
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save home'}
          </button>
        </div>
        {message && (
          <div className={message.ok ? 'okmsg' : 'err'} role="status">
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}

// The Wall page (/wall): live news on or off, which channel, and up to
// four extra clocks.
function WallSection({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const saved = me.preferences.wall ?? {};
  const [news, setNews] = useState(saved.news !== false);
  const [channel, setChannel] = useState(saved.channel ?? '');
  const [zones, setZones] = useState<{ label: string; tz: string }[]>(saved.zones ?? []);
  const [status, setStatus] = useState('');
  const zoneNames = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];

  async function save(next: { news?: boolean; channel?: string; zones?: { label: string; tz: string }[] }) {
    const wall = { news, channel: channel || undefined, zones, ...next };
    try {
      await savePreferences({ wall });
      await onSaved();
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  return (
    <section className="card">
      <div className="ph">
        <h2>Wall</h2>
        <Link className="btn small" to="/wall">
          Open the wall
        </Link>
      </div>
      <div className="srows">
        <label className="srow">
          <span className="srow-label">
            <b>Live news</b>
            <small>A live channel in the wall&apos;s right column</small>
          </span>
          <span className="lrow flat">
            <input
              type="checkbox"
              checked={news}
              onChange={(e) => {
                setNews(e.target.checked);
                void save({ news: e.target.checked });
              }}
            />
            <span className="tog" />
          </span>
        </label>
        <div className="srow">
          <span className="srow-label">
            <b>Channel</b>
            <small>Defaults to the first channel of your news player</small>
          </span>
          <select
            value={channel}
            disabled={!news}
            onChange={(e) => {
              setChannel(e.target.value);
              void save({ channel: e.target.value || undefined });
            }}
          >
            <option value="">Your news player&apos;s channel</option>
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="srow">
          <span className="srow-label">
            <b>Clocks</b>
            <small>UTC and home always show; add up to four more</small>
          </span>
          <div className="zonelist">
            {zones.map((z, i) => (
              <div key={i} className="zonerow">
                <input
                  value={z.label}
                  maxLength={16}
                  placeholder="Label"
                  aria-label="Clock label"
                  onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  onBlur={() => void save({})}
                />
                <select
                  value={z.tz}
                  aria-label="Time zone"
                  onChange={(e) => {
                    const next = zones.map((x, j) => (j === i ? { ...x, tz: e.target.value } : x));
                    setZones(next);
                    void save({ zones: next });
                  }}
                >
                  {zoneNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  className="btn small"
                  aria-label="Remove clock"
                  onClick={() => {
                    const next = zones.filter((_, j) => j !== i);
                    setZones(next);
                    void save({ zones: next });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {zones.length < 4 && (
              <button
                className="btn small"
                onClick={() => {
                  const next = [...zones, { label: 'Kyiv', tz: 'Europe/Kyiv' }];
                  setZones(next);
                  void save({ zones: next });
                }}
              >
                Add clock
              </button>
            )}
          </div>
        </div>
      </div>
      {status && <p className="quiet small pad">{status}</p>}
    </section>
  );
}

function DisplaySection({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const [banner, setBanner] = useState(me.preferences.show_banner === true);
  const [unitPref, setUnitPref] = useState<Units>(me.preferences.units === 'metric' ? 'metric' : 'imperial');

  async function chooseUnits(next: Units) {
    const before = unitPref;
    setUnitPref(next);
    try {
      await savePreferences({ units: next });
      await onSaved();
    } catch {
      setUnitPref(before);
    }
  }

  async function toggleBanner(next: boolean) {
    setBanner(next);
    try {
      await savePreferences({ show_banner: next });
      await onSaved();
    } catch {
      setBanner(!next);
    }
  }

  return (
    <section className="card">
      <div className="ph">
        <h2>Interface</h2>
      </div>
      <div className="srows">
        <div className="srow">
          <span className="srow-label">
            <b>Units</b>
            <small>Distances, lengths and heights. Aircraft stay in feet and knots, ships in knots.</small>
          </span>
          <div className="seg" role="group" aria-label="Units">
            {(['imperial', 'metric'] as const).map((u) => (
              <button key={u} aria-pressed={unitPref === u} onClick={() => void chooseUnits(u)}>
                {u === 'imperial' ? 'Imperial (mi, ft)' : 'Metric (km, m)'}
              </button>
            ))}
          </div>
        </div>
        <label className="srow">
          <span className="srow-label">
            <b>Classification line</b>
            <small>Shows “UNCLASSIFIED // OPEN SOURCE” in a thin strip above the header</small>
          </span>
          <span className="lrow flat">
            <input type="checkbox" checked={banner} onChange={(e) => void toggleBanner(e.target.checked)} />
            <span className="tog" />
          </span>
        </label>
        <div className="srow">
          <span className="srow-label">
            <b>Layers, base map and panels</b>
            <small>Saved automatically as you change them on the map</small>
          </span>
          <Link className="btn small" to="/">
            Open the map
          </Link>
        </div>
      </div>
    </section>
  );
}

function StreetMapSection() {
  const [info, setInfo] = useState<{ bounds: number[]; maxzoom: number } | null | 'none'>(null);
  useEffect(() => {
    fetch('/tiles/data/protomaps.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { bounds?: number[]; maxzoom?: number } | null) =>
        setInfo(j?.bounds ? { bounds: j.bounds, maxzoom: j.maxzoom ?? 15 } : 'none'),
      )
      .catch(() => setInfo('none'));
  }, []);

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Installed region</h2>
          <span className="mono">{info === null ? 'checking…' : info === 'none' ? 'none' : 'serving'}</span>
        </div>
        <div className="srows">
          {info && info !== 'none' ? (
            <>
              <div className="srow">
                <span className="srow-label">
                  <b>Area</b>
                  <small>West, south, east, north</small>
                </span>
                <span className="mono">{info.bounds.map((b) => b.toFixed(2)).join(', ')}</span>
              </div>
              <div className="srow">
                <span className="srow-label">
                  <b>Detail</b>
                  <small>Data to this zoom; drawn sharper beyond it</small>
                </span>
                <span className="mono">zoom {info.maxzoom}</span>
              </div>
            </>
          ) : (
            <div className="srow">
              <span className="srow-label">
                <b>No region installed</b>
                <small>The Dark map uses Esri street tiles everywhere</small>
              </span>
            </div>
          )}
        </div>
      </section>
      <section className="card">
        <div className="ph">
          <h2>Change or update the region</h2>
        </div>
        <div className="cbody">
          <p>Run on the server, next to docker-compose.yml. Every user sees the installed region.</p>
          <pre className="raw">{'make streetmap                    # Tennessee\nmake streetmap REGION=southeast   # tennessee, southeast, conus, planet\nscripts/streetmap.sh conus --dry-run   # size only'}</pre>
          <p className="quiet small">
            Data © OpenStreetMap contributors (ODbL), from the daily Protomaps build. See Documentation →
            Configuration → Street map.
          </p>
        </div>
      </section>
    </>
  );
}

interface AuditEntry {
  id: number;
  at: string;
  action: string;
  username: string | null;
  ip: string | null;
  detail: Record<string, unknown>;
}

const AUDIT_FILTERS = [
  ['', 'Everything'],
  ['auth.', 'Sign-ins'],
  ['users.', 'User management'],
  ['settings.', 'Settings'],
  ['setup.', 'Setup'],
] as const;

function AuditSection() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  async function load(before?: number) {
    const p = new URLSearchParams({ limit: '100' });
    if (before) p.set('before', String(before));
    if (filter) p.set('action', filter);
    try {
      const r = await api<{ entries: AuditEntry[] }>('/api/admin/audit?' + p.toString());
      setEntries((cur) => (before ? [...cur, ...r.entries] : r.entries));
      setMore(r.entries.length === 100);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the audit log.');
    }
  }
  useEffect(() => {
    void load();
    // Reload when the filter changes.
  }, [filter]);

  return (
    <section className="card wide">
      <div className="ph">
        <h2>Events</h2>
        <select className="ph-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          {AUDIT_FILTERS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="audit" role="table" aria-label="Audit log">
        {entries.map((e) => (
          <div key={e.id} className="arow" role="row">
            <span className="mono dim" role="cell" title={e.at}>
              {zuluTime(e.at)}
              <br />
              <small>{ago(e.at)}</small>
            </span>
            <span role="cell" className="mono">
              {e.action}
            </span>
            <span role="cell">{e.username ?? '—'}</span>
            <span role="cell" className="mono dim">
              {e.ip ?? ''}
            </span>
            <span role="cell" className="adetail">
              {Object.entries(e.detail)
                .map(([k, v]) => k + ': ' + String(v))
                .join(' · ')}
            </span>
          </div>
        ))}
        {!entries.length && !error && <p className="quiet pad">Nothing recorded yet.</p>}
      </div>
      {error && <p className="err pad">{error}</p>}
      {more && (
        <div className="cbody">
          <button className="btn" onClick={() => void load(entries[entries.length - 1]?.id)}>
            Older entries
          </button>
        </div>
      )}
    </section>
  );
}

function KeyCard({
  name,
  title,
  state,
  onSaved,
  children,
}: {
  name: string;
  title: string;
  state: KeyState | undefined;
  onSaved: (keys: Record<string, KeyState>) => void;
  children: ReactNode;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(next: string) {
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await saveKeys({ [name]: next }));
      setValue('');
      setMessage({ ok: true, text: next ? 'Saved.' : 'Key removed.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="ph">
        <h2>{title}</h2>
        <span className="mono">{state?.set ? 'key ' + (state.hint ?? '') : 'no key'}</span>
      </div>
      <div className="cbody">
        {children}
        <div className="field">
          <label htmlFor={'k-' + name}>{title} API key</label>
          <input
            id={'k-' + name}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={state?.set ? 'Saved key ' + (state.hint ?? '') + ' (leave blank to keep it)' : 'Paste the key'}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {state?.unreadable && <p className="err">The saved key can&apos;t be read (ARGUS_SECRET_KEY changed). Enter it again.</p>}
        <div className="actions">
          <button className="btn primary" disabled={busy || !value.trim()} onClick={() => void save(value.trim())}>
            Save key
          </button>
          {state?.set && (
            <button className="btn" disabled={busy} onClick={() => void save('')}>
              Remove key
            </button>
          )}
        </div>
        {message && (
          <div className={message.ok ? 'okmsg' : 'err'} role="status">
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}

function SourcesSection() {
  const [keys, setKeys] = useState<Record<string, KeyState> | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [k, s] = await Promise.all([getKeys(), api<{ sources: SourceStatus[] }>('/api/sources')]);
      setKeys(k);
      setSources(s.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      {error && <p className="err">{error}</p>}
      <KeyCard name="aisstream" title="AISStream" state={keys?.aisstream} onSaved={setKeys}>
        <p>
          Live ship positions come from <b>aisstream.io</b>, a free AIS network. Sign in there (with GitHub), create an
          API key under <b>API Keys</b>, and paste it here. The worker connects within a minute.
        </p>
      </KeyCard>
      <KeyCard name="openaip" title="openAIP" state={keys?.openaip} onSaved={setKeys}>
        <p>
          Restricted, prohibited and danger areas, control zones and terminal areas come from <b>openaip.net</b>. Make a
          free account, create an API key under your profile&apos;s <b>API clients</b>, and paste it here. Its data is
          for non-commercial use.
        </p>
      </KeyCard>
      <p className="quiet small">Keys are stored encrypted and used only by the server; browsers never see them.</p>
      <ReceiversCard />
      <section className="card wide">
        <div className="ph">
          <h2>Source health</h2>
          <button className="btn small" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <div className="srows">
          {sources.map((s) => (
            <div key={s.name} className="srow">
              <span className="srow-label">
                <b>
                  <i className={'sdot ' + (!s.enabled ? 'off' : s.last_error ? 'warn' : 'ok')} /> {s.label}
                </b>
                <small>{s.last_error ?? (s.enabled ? s.last_count + ' records last run' : 'off')}</small>
              </span>
              <span className="mono dim">{s.last_success_at ? ago(s.last_success_at) : 'never'}</span>
            </div>
          ))}
          {!sources.length && <p className="quiet pad">The worker hasn&apos;t reported yet.</p>}
        </div>
      </section>
    </>
  );
}

function ReceiversCard() {
  const [adsb, setAdsb] = useState('');
  const [ais, setAis] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    getReceivers()
      .then((r) => {
        setAdsb(r.adsb_url ?? '');
        setAis(r.ais_url ?? '');
      })
      .catch(() => undefined);
  }, []);
  async function save() {
    setMessage(null);
    try {
      await saveReceivers({ adsb_url: adsb.trim(), ais_url: ais.trim() });
      setMessage({ ok: true, text: 'Saved. The worker picks them up within a minute.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    }
  }
  return (
    <section className="card">
      <div className="ph">
        <h2>Your receivers</h2>
        <span className="mono">optional</span>
      </div>
      <div className="cbody">
        <p>
          If you run your own ADS-B or AIS receiver (an RTL-SDR on your network), Argus can read it. Aircraft and ships
          it hears are added to the map for everyone, alongside adsb.lol, adsb.fi and AISStream.
        </p>
        <div className="field">
          <label htmlFor="rx-adsb">ADS-B: readsb or tar1090 aircraft.json</label>
          <input
            id="rx-adsb"
            spellCheck={false}
            placeholder="http://192.168.1.50/tar1090/data/aircraft.json"
            value={adsb}
            onChange={(e) => setAdsb(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rx-ais">AIS: AIS-catcher web server ships.json</label>
          <input
            id="rx-ais"
            spellCheck={false}
            placeholder="http://192.168.1.50:8100/api/ships.json"
            value={ais}
            onChange={(e) => setAis(e.target.value)}
          />
        </div>
        <p className="quiet small">
          The worker container fetches these, so use an address it can reach (your receiver's LAN IP, not localhost).
          Leave a box empty to turn that receiver off.
        </p>
        <div className="actions">
          <button className="btn primary" onClick={() => void save()}>
            Save receivers
          </button>
        </div>
        {message && (
          <div className={message.ok ? 'okmsg' : 'err'} role="status">
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}
