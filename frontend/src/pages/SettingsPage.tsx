import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import AccountCard from '../components/AccountCard';
import AppHeader from '../components/AppHeader';
import HomePicker from '../components/HomePicker';
import ImageryCard from '../components/ImageryCard';
import UsersCard from '../components/UsersCard';
import WallEditor from '../components/WallEditor';
import { CHANNELS, DEFAULT_TABS } from '../config/newsChannels';
import {
  api,
  can,
  getDefaults,
  getKeys,
  getReceivers,
  getScreenWall,
  putScreenWall,
  type WallPrefs,
  type Home,
  type KeyState,
  type Me,
  putDefaults,
  saveKeys,
  saveReceivers,
  savePreferences,
  type ServerDefaults,
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
    id: 'displays',
    label: 'Displays',
    title: 'Wall displays',
    description: 'Pair a TV or kiosk with a code shown on its screen; it then shows the wall. No password is stored on the device.',
    group: 'Administration',
    capability: 'users.manage',
  },
  {
    id: 'defaults',
    label: 'Defaults',
    title: 'Defaults for everyone',
    description: 'What the map opens with for every user: layers and filters, news tabs and their order, and how video starts. Each user can still change their own.',
    group: 'Administration',
    capability: 'settings.manage',
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
  else if (current.id === 'defaults') body = <DefaultsSection me={me} onSaved={onSaved} />;
  else if (current.id === 'displays') body = <DisplaysSection />;
  else if (current.id === 'display')
    body = (
      <>
        <DisplaySection me={me} onSaved={onSaved} />
        <VideoSection me={me} onSaved={onSaved} />
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

interface DisplayRow {
  id: number;
  name: string;
  active: boolean;
  paired_at: string;
  last_seen: string | null;
}

// Pair wall screens: the screen opens /pair and shows a code; enter it
// here with a name. Unpair to cut a screen off.
// One paired screen's wall settings, loaded when opened.
function ScreenWall({ row }: { row: DisplayRow }) {
  const [data, setData] = useState<{ wall: WallPrefs; home: Home | null } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getScreenWall(row.id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load.'));
  }, [row.id]);
  if (error) return <p className="quiet small pad">{error}</p>;
  if (!data) return <p className="quiet small pad">Loading…</p>;
  return (
    <WallEditor
      value={data.wall}
      home={data.home}
      withHome
      onSave={async (wall, home) => {
        setData(await putScreenWall(row.id, wall, home));
      }}
    />
  );
}

function DisplaysSection() {
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<{ displays: DisplayRow[] }>('/api/admin/displays')
      .then((r) => setRows(r.displays))
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load displays.'));
  useEffect(() => {
    void load();
  }, []);

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/displays', { method: 'POST', body: { code: code.replace(/\s/g, ''), name } });
      setStatus('Paired. The screen will show the wall in a few seconds.');
      setCode('');
      setName('');
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not pair.');
    } finally {
      setBusy(false);
    }
  }

  async function unpair(row: DisplayRow) {
    if (!window.confirm('Unpair ' + row.name + '? It stops showing the wall straight away.')) return;
    try {
      await api('/api/admin/displays/' + row.id, { method: 'DELETE' });
      setStatus(row.name + ' unpaired.');
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not unpair.');
    }
  }

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Pair a screen</h2>
        </div>
        <form className="cbody" onSubmit={(e) => void pair(e)}>
          <p className="quiet small">
            On the TV or kiosk, open <span className="mono">{window.location.origin}/pair</span>. Enter the code it shows
            and a name for it.
          </p>
          <div className="pairform">
            <div className="field">
              <label htmlFor="pair-code">Code</label>
              <input
                id="pair-code"
                className="mono"
                value={code}
                maxLength={8}
                placeholder="ABC 123"
                autoComplete="off"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <label htmlFor="pair-name">Name</label>
              <input id="pair-name" value={name} maxLength={80} placeholder="Ops room TV" onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn primary" disabled={busy || code.replace(/\s/g, '').length < 6 || !name.trim()}>
              Pair
            </button>
          </div>
          {status && <p className="quiet small">{status}</p>}
        </form>
      </section>
      <section className="card">
        <div className="ph">
          <h2>Paired screens</h2>
          <span className="mono">{rows.filter((r) => r.active).length}</span>
        </div>
        <div className="cbody tblwrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Paired</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? undefined : 'dimrow'}>
                  <td>{r.name}</td>
                  <td className="mono">{ago(r.paired_at)}</td>
                  <td className="mono">{r.last_seen ? ago(r.last_seen) : '—'}</td>
                  <td>
                    {r.active ? (
                      <span className="rowbtns">
                        <button className="btn small" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {open === r.id ? 'Close' : 'Wall settings'}
                        </button>
                        <button className="btn small" onClick={() => void unpair(r)}>
                          Unpair
                        </button>
                      </span>
                    ) : (
                      <span className="quiet small">Unpaired</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="quiet">
                    No screens yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {rows
        .filter((r) => r.active && r.id === open)
        .map((r) => (
          <section className="card" key={r.id}>
            <div className="ph">
              <h2>Wall settings · {r.name}</h2>
            </div>
            <ScreenWall row={r} />
          </section>
        ))}
    </>
  );
}

// The map groups a user's layer choices are saved under (MapPage).
const LAYER_KEYS = ['layers', 'air', 'reference', 'space', 'sea', 'airspace', 'infra', 'tension'] as const;

function VideoControls({
  value,
  onChange,
}: {
  value: { muted: boolean; volume: number };
  onChange: (v: { muted: boolean; volume: number }) => void;
}) {
  return (
    <>
      <label className="srow">
        <span className="srow-label">
          <b>Start muted</b>
          <small>Browsers may still start a stream muted until you click on the page</small>
        </span>
        <span className="lrow flat">
          <input type="checkbox" checked={value.muted} onChange={(e) => onChange({ ...value, muted: e.target.checked })} />
          <span className="tog" />
        </span>
      </label>
      <div className="srow">
        <span className="srow-label">
          <b>Volume</b>
          <small>YouTube streams; Rumble uses its own setting</small>
        </span>
        <span className="volrow">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value.volume}
            aria-label="Volume"
            onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
          />
          <span className="mono">{value.volume}%</span>
        </span>
      </div>
    </>
  );
}

// Your own video defaults (news player, wall), over the server's.
function VideoSection({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const base = { muted: true, volume: 50, ...(me.defaults?.video ?? {}), ...(me.preferences.video ?? {}) };
  const [video, setVideo] = useState(base);
  const [status, setStatus] = useState('');
  async function save(v: { muted: boolean; volume: number }) {
    setVideo(v);
    try {
      await savePreferences({ video: v });
      await onSaved();
      setStatus('Saved. Applies to streams you open from now on.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  return (
    <section className="card">
      <div className="ph">
        <h2>Video</h2>
      </div>
      <div className="srows">
        <VideoControls value={video} onChange={(v) => void save(v)} />
      </div>
      {status && <p className="quiet small pad">{status}</p>}
    </section>
  );
}

// Server-wide defaults (admins): layers from your own map, news tabs in
// order, video.
function DefaultsSection({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const [defaults, setDefaults] = useState<ServerDefaults | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    getDefaults()
      .then(setDefaults)
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load the defaults.'));
  }, []);
  if (!defaults) return <p className="quiet pad">{status || 'Loading…'}</p>;
  const tabs = defaults.news?.tabs ?? DEFAULT_TABS;
  const video = { muted: true, volume: 50, ...(defaults.video ?? {}) };
  const ordered = [
    ...tabs.map((id) => CHANNELS.find((c) => c.id === id)).filter((c): c is (typeof CHANNELS)[number] => Boolean(c)),
    ...CHANNELS.filter((c) => !tabs.includes(c.id)),
  ];

  async function save(next: ServerDefaults, message = 'Saved for everyone.') {
    setDefaults(next);
    try {
      setDefaults(await putDefaults(next));
      await onSaved();
      setStatus(message);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  const setTabs = (next: string[]) => void save({ ...defaults, news: { tabs: next } });
  const move = (id: string, by: number) => {
    const i = tabs.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= tabs.length) return;
    const next = [...tabs];
    [next[i], next[j]] = [next[j], next[i]];
    setTabs(next);
  };
  const mine: Record<string, unknown> = {};
  for (const k of LAYER_KEYS) if (me.preferences[k] !== undefined) mine[k === 'layers' ? 'types' : k] = me.preferences[k];
  const layerCount = defaults.layers ? Object.keys(defaults.layers).length : 0;

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Layers and filters</h2>
        </div>
        <div className="srows">
          <div className="srow">
            <span className="srow-label">
              <b>Default layers</b>
              <small>
                {layerCount
                  ? 'Set from an admin\'s map. New users start with these, and Reset filters returns to them.'
                  : 'Built-in defaults. Set the layers on your map the way you want them, then copy them here.'}
              </small>
            </span>
            <span className="actions">
              <button className="btn small" onClick={() => void save({ ...defaults, layers: mine }, 'Your current map layers are now the default.')}>
                Use my current map layers
              </button>
              {layerCount > 0 && (
                <button className="btn small" onClick={() => void save({ ...defaults, layers: undefined }, 'Back to the built-in layers.')}>
                  Use built-in
                </button>
              )}
            </span>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="ph">
          <h2>News tabs</h2>
          <span className="mono">{tabs.length} tabs</span>
        </div>
        <p className="quiet small pad">
          Tick the channels that get a tab, and use the arrows to set their order. Users who haven&apos;t chosen their
          own tabs get these.
        </p>
        <ul className="chanlist">
          {ordered.map((c) => {
            const on = tabs.includes(c.id);
            return (
              <li key={c.id} className={on ? 'on' : undefined}>
                <label className="lrow flat">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setTabs(on ? tabs.filter((t) => t !== c.id) : [...tabs, c.id])}
                  />
                  <span className="tog" />
                </label>
                <span className="cname">
                  <b>{c.name}</b>
                  <small>
                    {c.group}
                    {c.platform === 'rumble' ? ' · Rumble' : ''}
                  </small>
                </span>
                {on && (
                  <span className="actions">
                    <button className="btn small" aria-label={'Move ' + c.name + ' up'} disabled={tabs[0] === c.id} onClick={() => move(c.id, -1)}>
                      ↑
                    </button>
                    <button
                      className="btn small"
                      aria-label={'Move ' + c.name + ' down'}
                      disabled={tabs[tabs.length - 1] === c.id}
                      onClick={() => move(c.id, 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card">
        <div className="ph">
          <h2>Video</h2>
        </div>
        <div className="srows">
          <VideoControls value={video} onChange={(v) => void save({ ...defaults, video: v })} />
        </div>
      </section>
      {status && <p className="quiet small pad">{status}</p>}
    </>
  );
}

// The Wall page (/wall): live news on or off, which channel, and up to
// four extra clocks.
function WallSection({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  return (
    <section className="card">
      <div className="ph">
        <h2>Wall</h2>
        <Link className="btn small" to="/wall">
          Open the wall
        </Link>
      </div>
      <p className="quiet small pad">
        How <span className="mono">/wall</span> looks when you open it. Paired screens have their own settings under
        Displays.
      </p>
      <WallEditor
        value={me.preferences.wall ?? {}}
        onSave={async (wall) => {
          await savePreferences({ wall });
          await onSaved();
        }}
      />
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
