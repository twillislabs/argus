import { useEffect, useState } from 'react';

import {
  type AlertRule,
  type Area,
  areaLabel,
  type Channels,
  createRule,
  deleteRule,
  drawingArea,
  getChannels,
  getRules,
  homeArea,
  KIND_LABEL,
  newTopic,
  putChannels,
  type RuleKind,
  saveRule,
  testPush,
} from '../lib/alerts';
import { getRaids, type Me } from '../lib/api';
import { SEVERITY_NAME } from '../lib/format';
import type { Drawing } from '../map/drawTools';

// Settings > Alerts: where your alerts go (ntfy, a webhook, quiet hours)
// and your rules. Argus checks rules every minute; each alert fires once.

const KINDS: RuleKind[] = ['events', 'raids', 'airport', 'pattern', 'watch', 'sanctions', 'space'];
const SANCTION_CATEGORIES = [
  ['sanction', 'Sanctioned'],
  ['mare.shadow', 'Shadow fleet'],
  ['poi', 'War-related list'],
] as const;
const TYPES = ['conflict', 'unrest', 'quake', 'fire', 'hazard', 'maritime'] as const;

type Draft = Omit<AlertRule, 'id' | 'created_at' | 'last_fired_at'> & { id?: number };

function blank(kind: RuleKind, me: Me): Draft {
  const home = me.preferences.home;
  const params: Record<string, unknown> = {
    events: { area: home ? homeArea(home) : undefined, min_severity: 4, types: [] },
    raids: { ukraine: ['*'], israel: true },
    airport: { codes: [], levels: ['stop'] },
    pattern: { air: true, sea: true },
    watch: { aircraft: [], vessels: [] },
    sanctions: { categories: ['sanction', 'mare.shadow'] },
    space: { g_min: 3 },
  }[kind] as Record<string, unknown>;
  return { name: KIND_LABEL[kind], kind, params, enabled: true, push: true };
}

function summary(r: Draft): string {
  const p = r.params as Record<string, unknown>;
  switch (r.kind) {
    case 'events':
      return (
        SEVERITY_NAME[Number(p.min_severity) || 4] +
        ' or worse' +
        ((p.types as string[])?.length ? ' · ' + (p.types as string[]).join(', ') : '') +
        ' · ' +
        areaLabel(p.area as Area)
      );
    case 'raids':
      return [
        (p.ukraine as string[])?.length
          ? 'Ukraine: ' +
            ((p.ukraine as string[]).includes('*') ? 'any oblast' : (p.ukraine as string[]).length + ' oblasts')
          : '',
        p.israel ? 'Israel' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'airport':
      return ((p.codes as string[]) ?? []).join(', ') + ' · ' + ((p.levels as string[]) ?? []).join(' or ');
    case 'pattern':
      return (
        [p.air ? 'aircraft orbits' : '', p.sea ? 'ships loitering on cables' : ''].filter(Boolean).join(', ') +
        ' · ' +
        areaLabel(p.area as Area)
      );
    case 'watch':
      return (
        [...((p.aircraft as string[]) ?? []), ...((p.vessels as number[]) ?? []).map(String)].join(', ') ||
        'Nothing yet'
      );
    case 'sanctions':
      return (
        ((p.categories as string[]) ?? [])
          .map((c) => SANCTION_CATEGORIES.find((x) => x[0] === c)?.[1] ?? c)
          .join(', ') +
        ' · ' +
        areaLabel(p.area as Area)
      );
    case 'space':
      return 'G' + p.g_min + ' or stronger';
  }
}

export default function AlertsSection({ me }: { me: Me }) {
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    getRules()
      .then((r) => setRules(r.rules))
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load.'));
  }, []);

  async function submit(d: Draft) {
    try {
      const saved = d.id ? await saveRule(d as AlertRule) : await createRule(d);
      setRules((rs) => (d.id ? (rs ?? []).map((x) => (x.id === saved.id ? saved : x)) : [...(rs ?? []), saved]));
      setEditing(null);
      setStatus('Saved. Argus checks rules every minute; it only alerts for things that start from now.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  return (
    <>
      <ChannelsCard />
      <section className="card">
        <div className="ph">
          <h2>Rules</h2>
          <span className="mono">{rules?.length ?? '–'}</span>
        </div>
        <div className="cbody">
          {status && <p className="quiet small">{status}</p>}
          <ul className="rulelist">
            {(rules ?? []).map((r) => (
              <li key={r.id} className={r.enabled ? undefined : 'dimrow'}>
                <div>
                  <b>{r.name}</b>
                  <small>
                    {KIND_LABEL[r.kind]} · {summary(r)}
                    {r.push ? '' : ' · in Argus only'}
                    {r.last_fired_at ? ' · last ' + new Date(r.last_fired_at).toLocaleString() : ''}
                  </small>
                </div>
                <span className="rowbtns">
                  <label className="lrow flat" title={r.enabled ? 'On' : 'Off'}>
                    <input
                      type="checkbox"
                      aria-label={'Turn ' + r.name + (r.enabled ? ' off' : ' on')}
                      checked={r.enabled}
                      onChange={(e) => void submit({ ...r, enabled: e.target.checked })}
                    />
                    <span className="tog" />
                  </label>
                  <button className="btn small" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                  <button
                    className="btn small"
                    onClick={async () => {
                      if (!window.confirm('Delete the rule "' + r.name + '"?')) return;
                      await deleteRule(r.id);
                      setRules((rs) => (rs ?? []).filter((x) => x.id !== r.id));
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
            {rules?.length === 0 && <li className="quiet">No rules yet. Add one below.</li>}
          </ul>
          {!editing && (
            <div className="addrule">
              <span className="quiet small">Add a rule:</span>
              {KINDS.map((k) => (
                <button key={k} className="btn small" onClick={() => setEditing(blank(k, me))}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
        </div>
        {editing && <RuleEditor me={me} draft={editing} onCancel={() => setEditing(null)} onSave={submit} />}
      </section>
    </>
  );
}

function ChannelsCard() {
  const [c, setC] = useState<Channels | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [hook, setHook] = useState<string | null>(null);
  const [form, setForm] = useState({
    ntfy_server: '',
    webhook_format: 'json' as Channels['webhook_format'],
    quiet_from: '',
    quiet_to: '',
  });
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    getChannels()
      .then((r) => {
        setC(r);
        setForm({
          ntfy_server: r.ntfy_server,
          webhook_format: r.webhook_format,
          quiet_from: r.quiet_from,
          quiet_to: r.quiet_to,
        });
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load.'));
  }, []);
  if (!c) return <p className="quiet small pad">{status || 'Loading…'}</p>;

  const change = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setDirty(true);
  };

  async function save(): Promise<boolean> {
    setStatus('Saving…');
    try {
      const r = await putChannels({
        ...form,
        ntfy_topic: topic,
        webhook_url: hook,
        base_url: window.location.origin,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setC(r);
      setTopic(null);
      setHook(null);
      setDirty(false);
      setStatus('Saved.');
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
      return false;
    }
  }

  async function test() {
    if ((dirty || topic !== null || hook !== null) && !(await save())) return;
    setStatus('Sending a test…');
    try {
      const r = await testPush();
      setStatus(r.result === 'off' ? 'Nothing to send to: add an ntfy topic or a webhook first.' : 'Test: ' + r.result);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'The test failed.');
    }
  }

  const unsaved = dirty || topic !== null || hook !== null;
  const server = form.ntfy_server || c.default_ntfy;
  return (
    <section className="card">
      <div className="ph">
        <h2>Delivery</h2>
      </div>
      <div className="cbody">
        <p className="quiet small">
          Alerts always appear under the bell at the top of Argus (and as browser notifications while it&apos;s open, if
          you allow them). To get them on your phone too, use <b>ntfy</b>: install the free ntfy app, then subscribe to
          your topic below. Anyone who knows the topic can read it, so keep it private.
        </p>
      </div>
      <div className="srows">
        <div className="srow col">
          <span className="srow-label">
            <b>ntfy</b>
            <small>Push to your phone or desktop</small>
          </span>
          <div className="aigrid">
            <label className="field">
              <span>Server</span>
              <input
                value={form.ntfy_server}
                placeholder={c.default_ntfy}
                onChange={(e) => change({ ntfy_server: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Topic</span>
              {topic === null && c.ntfy_topic_hint ? (
                <span className="keyset">
                  <span className="mono">{c.ntfy_topic_hint}</span>
                  <button className="btn small" onClick={() => setTopic('')}>
                    Change or remove
                  </button>
                </span>
              ) : (
                <span className="keyset">
                  <input value={topic ?? ''} placeholder="argus-…" onChange={(e) => setTopic(e.target.value)} />
                  <button className="btn small" onClick={() => setTopic(newTopic())}>
                    Make one
                  </button>
                </span>
              )}
            </label>
          </div>
          {topic && (
            <p className="quiet small">
              In the ntfy app, subscribe to <span className="mono">{topic}</span>
              {form.ntfy_server ? ' on ' + server : ''}. Save, then <b>Send a test</b>.
            </p>
          )}
        </div>
        <div className="srow col">
          <span className="srow-label">
            <b>Webhook</b>
            <small>POST each alert to a URL: Discord, Slack, Home Assistant, n8n and similar</small>
          </span>
          <div className="aigrid">
            <label className="field">
              <span>URL</span>
              {hook === null && c.webhook_hint ? (
                <span className="keyset">
                  <span className="mono">{c.webhook_hint}</span>
                  <button className="btn small" onClick={() => setHook('')}>
                    Change or remove
                  </button>
                </span>
              ) : (
                <input value={hook ?? ''} placeholder="https://…" onChange={(e) => setHook(e.target.value)} />
              )}
            </label>
            <label className="field">
              <span>Format</span>
              <select
                value={form.webhook_format}
                onChange={(e) => change({ webhook_format: e.target.value as Channels['webhook_format'] })}
              >
                <option value="json">JSON (title, body, url, severity…)</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
              </select>
            </label>
          </div>
        </div>
        <div className="srow">
          <span className="srow-label">
            <b>Quiet hours</b>
            <small>No pushes between these times (your time zone); alerts still show under the bell</small>
          </span>
          <span className="aifeat">
            <input
              type="time"
              aria-label="Quiet from"
              value={form.quiet_from}
              onChange={(e) => change({ quiet_from: e.target.value })}
            />
            <span className="quiet small">to</span>
            <input
              type="time"
              aria-label="Quiet until"
              value={form.quiet_to}
              onChange={(e) => change({ quiet_to: e.target.value })}
            />
          </span>
        </div>
        <div className="srow">
          <span className={'small ' + (unsaved ? 'unsaved' : 'quiet')}>{unsaved ? 'Unsaved changes.' : status}</span>
          <span className="rowbtns">
            <button className="btn small" onClick={() => void test()}>
              {unsaved ? 'Save and send a test' : 'Send a test'}
            </button>
            <button className="btn primary" disabled={!unsaved} onClick={() => void save()}>
              Save
            </button>
          </span>
        </div>
      </div>
    </section>
  );
}

function AreaPicker({ me, value, onChange }: { me: Me; value?: Area; onChange: (a?: Area) => void }) {
  const home = me.preferences.home;
  const drawings = ((me.preferences.drawings as Drawing[] | undefined) ?? [])
    .map((d) => ({ d, area: drawingArea(d) }))
    .filter((x): x is { d: Drawing; area: Area } => x.area !== null);
  const current = !value
    ? 'any'
    : value.label?.startsWith('Home')
      ? 'home'
      : 'd:' +
        (drawings.find(
          (x) =>
            x.area.label === value.label &&
            JSON.stringify(x.area.ring ?? x.area.center) === JSON.stringify(value.ring ?? value.center),
        )?.d.id ?? '');
  return (
    <select
      aria-label="Area"
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'any') onChange(undefined);
        else if (v === 'home' && home) onChange(homeArea(home));
        else {
          const hit = drawings.find((x) => 'd:' + x.d.id === v);
          if (hit) onChange({ ...hit.area, label: hit.d.label || hit.area.label });
        }
      }}
    >
      <option value="any">Anywhere</option>
      {home && (
        <option value="home">
          Home: {home.name}, {home.radius_km} km
        </option>
      )}
      {drawings.map((x, i) => (
        <option key={x.d.id} value={'d:' + x.d.id}>
          {x.d.label || x.area.label + ' ' + (i + 1)}
        </option>
      ))}
      {current === 'd:' && <option value="d:">{value?.label ?? 'Saved area'}</option>}
    </select>
  );
}

function RuleEditor({
  me,
  draft,
  onCancel,
  onSave,
}: {
  me: Me;
  draft: Draft;
  onCancel: () => void;
  onSave: (d: Draft) => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [oblasts, setOblasts] = useState<{ id: string; name: string }[]>([]);
  const p = d.params as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => setD({ ...d, params: { ...d.params, ...patch } });
  useEffect(() => {
    if (d.kind !== 'raids') return;
    getRaids()
      .then((r) =>
        setOblasts(r.ukraine.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name))),
      )
      .catch(() => undefined);
  }, [d.kind]);
  const list = (v: unknown) => ((v as unknown[]) ?? []).map(String).join(', ');
  const split = (s: string) =>
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <div className="srows ruleedit">
      <div className="srow">
        <span className="srow-label">
          <b>{KIND_LABEL[d.kind]}</b>
          <small>Name it so you&apos;ll recognise it on your phone</small>
        </span>
        <input
          className="ruleinput"
          value={d.name}
          maxLength={80}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
      </div>
      {d.kind === 'events' && (
        <>
          <div className="srow">
            <span className="srow-label">
              <b>Where</b>
              <small>Your home radius, a shape you drew on the map, or anywhere</small>
            </span>
            <AreaPicker me={me} value={p.area as Area} onChange={(area) => set({ area })} />
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>How serious</b>
              <small>This severity or worse</small>
            </span>
            <select value={Number(p.min_severity) || 4} onChange={(e) => set({ min_severity: Number(e.target.value) })}>
              {[5, 4, 3, 2].map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_NAME[s]}
                  {s < 5 ? ' or worse' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Kinds</b>
              <small>None ticked means every kind</small>
            </span>
            <span className="aifeat">
              {TYPES.map((t) => (
                <label key={t} className="check">
                  <input
                    type="checkbox"
                    checked={((p.types as string[]) ?? []).includes(t)}
                    onChange={(e) =>
                      set({
                        types: e.target.checked
                          ? [...((p.types as string[]) ?? []), t]
                          : ((p.types as string[]) ?? []).filter((x) => x !== t),
                      })
                    }
                  />
                  {t}
                </label>
              ))}
            </span>
          </div>
        </>
      )}
      {d.kind === 'raids' && (
        <>
          <div className="srow col">
            <span className="srow-label">
              <b>Ukraine</b>
              <small>Any oblast, or just the ones you pick (continuous alerts in occupied areas never fire)</small>
            </span>
            <span className="aifeat">
              <label className="check">
                <input
                  type="checkbox"
                  checked={((p.ukraine as string[]) ?? []).includes('*')}
                  onChange={(e) => set({ ukraine: e.target.checked ? ['*'] : [] })}
                />
                Any oblast
              </label>
              {!((p.ukraine as string[]) ?? []).includes('*') &&
                oblasts.map((o) => (
                  <label key={o.id} className="check">
                    <input
                      type="checkbox"
                      checked={((p.ukraine as string[]) ?? []).includes(o.id)}
                      onChange={(e) =>
                        set({
                          ukraine: e.target.checked
                            ? [...((p.ukraine as string[]) ?? []), o.id]
                            : ((p.ukraine as string[]) ?? []).filter((x) => x !== o.id),
                        })
                      }
                    />
                    {o.name.replace(/ Oblast$/, '')}
                  </label>
                ))}
            </span>
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Israel</b>
              <small>Any Home Front Command alert (not drills)</small>
            </span>
            <label className="lrow flat">
              <input type="checkbox" checked={Boolean(p.israel)} onChange={(e) => set({ israel: e.target.checked })} />
              <span className="tog" />
            </label>
          </div>
        </>
      )}
      {d.kind === 'airport' && (
        <>
          <div className="srow">
            <span className="srow-label">
              <b>Airports</b>
              <small>US airport codes, for example BNA, ATL, ORD</small>
            </span>
            <input
              className="ruleinput"
              value={list(p.codes)}
              onChange={(e) => set({ codes: split(e.target.value.toUpperCase()) })}
            />
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>When</b>
              <small>A ground stop or full closure, and optionally delays; once a day per airport</small>
            </span>
            <span className="aifeat">
              {(['stop', 'delay'] as const).map((l) => (
                <label key={l} className="check">
                  <input
                    type="checkbox"
                    checked={((p.levels as string[]) ?? []).includes(l)}
                    onChange={(e) =>
                      set({
                        levels: e.target.checked
                          ? [...((p.levels as string[]) ?? []), l]
                          : ((p.levels as string[]) ?? []).filter((x) => x !== l),
                      })
                    }
                  />
                  {l === 'stop' ? 'Ground stop or closure' : 'Delays'}
                </label>
              ))}
            </span>
          </div>
        </>
      )}
      {d.kind === 'pattern' && (
        <>
          <div className="srow">
            <span className="srow-label">
              <b>What</b>
              <small>The same patterns the Situation panel lists</small>
            </span>
            <span className="aifeat">
              <label className="check">
                <input type="checkbox" checked={p.air !== false} onChange={(e) => set({ air: e.target.checked })} />
                Military aircraft orbits and racetracks
              </label>
              <label className="check">
                <input type="checkbox" checked={p.sea !== false} onChange={(e) => set({ sea: e.target.checked })} />
                Ships loitering on cables
              </label>
            </span>
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Where</b>
              <small>Your home radius, a drawn shape, or anywhere</small>
            </span>
            <AreaPicker me={me} value={p.area as Area} onChange={(area) => set({ area })} />
          </div>
        </>
      )}
      {d.kind === 'watch' && (
        <>
          <div className="srow">
            <span className="srow-label">
              <b>Military aircraft</b>
              <small>Hex codes, callsigns or registrations, separated by commas; once a day each</small>
            </span>
            <input
              className="ruleinput"
              value={list(p.aircraft)}
              onChange={(e) => set({ aircraft: split(e.target.value) })}
            />
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Ships</b>
              <small>MMSI numbers (the 9 digits on a ship&apos;s panel)</small>
            </span>
            <input
              className="ruleinput"
              value={list(p.vessels)}
              onChange={(e) =>
                set({
                  vessels: split(e.target.value)
                    .filter((x) => /^\d{9}$/.test(x))
                    .map(Number),
                })
              }
            />
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Where</b>
              <small>Only when inside this area, or anywhere</small>
            </span>
            <AreaPicker me={me} value={p.area as Area} onChange={(area) => set({ area })} />
          </div>
        </>
      )}
      {d.kind === 'sanctions' && (
        <>
          <div className="srow">
            <span className="srow-label">
              <b>Which lists</b>
              <small>Ships matched by IMO or MMSI to OpenSanctions&apos; maritime data; once a day each</small>
            </span>
            <span className="aifeat">
              {SANCTION_CATEGORIES.map(([id, label]) => (
                <label key={id} className="check">
                  <input
                    type="checkbox"
                    checked={((p.categories as string[]) ?? []).includes(id)}
                    onChange={(e) =>
                      set({
                        categories: e.target.checked
                          ? [...((p.categories as string[]) ?? []), id]
                          : ((p.categories as string[]) ?? []).filter((x) => x !== id),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </span>
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Where</b>
              <small>Only when inside this area, or anywhere Argus sees ships</small>
            </span>
            <AreaPicker me={me} value={p.area as Area} onChange={(area) => set({ area })} />
          </div>
        </>
      )}
      {d.kind === 'space' && (
        <div className="srow">
          <span className="srow-label">
            <b>Storm level</b>
            <small>NOAA geomagnetic storm scale; G3+ can disrupt GPS and HF radio</small>
          </span>
          <select value={Number(p.g_min) || 3} onChange={(e) => set({ g_min: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((g) => (
              <option key={g} value={g}>
                G{g} or stronger
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="srow">
        <span className="srow-label">
          <b>Push</b>
          <small>Send to ntfy and the webhook too, not just the bell</small>
        </span>
        <label className="lrow flat">
          <input type="checkbox" checked={d.push} onChange={(e) => setD({ ...d, push: e.target.checked })} />
          <span className="tog" />
        </label>
      </div>
      <div className="srow">
        <span />
        <span className="rowbtns">
          <button className="btn small" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!d.name.trim()} onClick={() => void onSave(d)}>
            {d.id ? 'Save rule' : 'Add rule'}
          </button>
        </span>
      </div>
    </div>
  );
}
