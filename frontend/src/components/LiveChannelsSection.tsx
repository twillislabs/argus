import { useEffect, useMemo, useState } from 'react';

import { type ChannelsState, getChannels, lookupChannel, putChannels, resetChannels } from '../lib/api';

// Settings > Live channels (admins): the YouTube and Rumble channels the
// news player, the News page and the Wall offer, in this order. A
// channel is added from a link, @handle or channel ID: the server looks
// it up for its ID, name and whether it's live now. Each change is saved
// at once; Reset goes back to Argus's built-in list.

type Item = ChannelsState['items'][number];
type Found = Awaited<ReturnType<typeof lookupChannel>>;

const STATUS: Record<string, string> = {
  live: 'Live now',
  upcoming: 'Live stream scheduled',
  offline: 'Not live right now',
  error: 'Could not check',
};

export default function LiveChannelsSection({ onSaved }: { onSaved: () => Promise<void> }) {
  const [state, setState] = useState<ChannelsState | null>(null);
  const [status, setStatus] = useState('');
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState<'youtube' | 'rumble'>('youtube');
  const [found, setFound] = useState<Found | null>(null);
  const [draft, setDraft] = useState<{ name: string; short: string; group: string }>({
    name: '',
    short: '',
    group: '',
  });
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, string>>({});
  // A channel being renamed or regrouped: its index and the new values.
  const [edit, setEdit] = useState<{ index: number; name: string; short: string; group: string } | null>(null);
  useEffect(() => {
    getChannels()
      .then(setState)
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load the channels.'));
  }, []);
  const groups = useMemo(() => [...new Set((state?.items ?? []).map((c) => c.group))], [state]);
  if (!state) return <p className="quiet pad">{status || 'Loading…'}</p>;
  const items = state.items;

  async function save(next: Item[], message = 'Saved.') {
    try {
      setState(await putChannels(next));
      // The players read the list from your account: re-read it.
      await onSaved();
      setStatus(message);
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
      return false;
    }
  }
  async function look() {
    setBusy(true);
    setFound(null);
    setStatus('');
    try {
      const f = await lookupChannel(input.trim(), platform);
      if (items.some((c) => c.id === f.id && c.platform === f.platform)) {
        setStatus(f.name + ' is already in the list.');
        return;
      }
      setFound(f);
      setDraft({ name: f.name, short: f.name.slice(0, 24), group: groups[0] ?? 'US' });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not look it up.');
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!found) return;
    const item: Item = {
      id: found.id,
      platform: found.platform,
      name: draft.name.trim() || found.name,
      short: draft.short.trim() || draft.name.trim().slice(0, 24),
      group: draft.group.trim() || 'Other',
      enabled: true,
    };
    if (await save([...items, item], 'Added ' + item.name + '.')) {
      setFound(null);
      setInput('');
    }
  }
  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
  }
  async function check(c: Item) {
    const key = c.platform + ':' + c.id;
    setChecks((m) => ({ ...m, [key]: 'Checking…' }));
    try {
      const p = c.platform ?? 'youtube';
      const f = await lookupChannel(p === 'rumble' ? 'https://rumble.com/c/' + c.id : c.id, p);
      setChecks((m) => ({ ...m, [key]: STATUS[f.status] ?? f.status }));
    } catch (err) {
      setChecks((m) => ({ ...m, [key]: err instanceof Error ? err.message : 'Could not check' }));
    }
  }

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Add a channel</h2>
          <span className="mono">
            {items.length} channels · {state.customised ? 'edited' : 'built-in list'}
          </span>
        </div>
        <div className="srows">
          <div className="srow col">
            <div className="aigrid">
              <label className="field">
                <span>Channel link, @handle or ID</span>
                <input
                  value={input}
                  placeholder="https://www.youtube.com/@LiveNOWFOX"
                  maxLength={300}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && input.trim().length > 1 && void look()}
                />
              </label>
              <label className="field">
                <span>Platform</span>
                <select value={platform} onChange={(e) => setPlatform(e.target.value as 'youtube' | 'rumble')}>
                  <option value="youtube">YouTube</option>
                  <option value="rumble">Rumble</option>
                </select>
              </label>
            </div>
            <p className="quiet small">
              Only add channels with a true live stream (around the clock, or a live TV simulcast): the player shows a
              channel&apos;s current live video, and nothing when it isn&apos;t live.
            </p>
            <span className="actions">
              <button
                className="btn small primary"
                disabled={busy || input.trim().length < 2}
                onClick={() => void look()}
              >
                {busy ? 'Looking up…' : 'Look up'}
              </button>
              {state.customised && (
                <button
                  className="btn small"
                  onClick={() => {
                    if (!window.confirm('Go back to the built-in channels? Your additions and changes are removed.'))
                      return;
                    void resetChannels().then(async (s) => {
                      setState(s);
                      await onSaved();
                      setStatus('Back to the built-in channels.');
                    });
                  }}
                >
                  Reset to built-in
                </button>
              )}
            </span>
            {found && (
              <div className="feedtest">
                <p className={found.status === 'live' ? 'ok small' : 'quiet small'}>
                  Found <b>{found.name}</b> ({found.platform === 'rumble' ? 'Rumble' : 'YouTube'}{' '}
                  <span className="mono">{found.id}</span>): {STATUS[found.status] ?? found.status}.
                </p>
                <div className="aigrid">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={draft.name}
                      maxLength={80}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Tab label</span>
                    <input
                      value={draft.short}
                      maxLength={24}
                      onChange={(e) => setDraft({ ...draft, short: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Group</span>
                    <input
                      list="channel-groups"
                      value={draft.group}
                      maxLength={40}
                      onChange={(e) => setDraft({ ...draft, group: e.target.value })}
                    />
                    <datalist id="channel-groups">
                      {groups.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </label>
                </div>
                <span className="actions">
                  <button className="btn small primary" onClick={() => void add()}>
                    Add channel
                  </button>
                  <button className="btn small" onClick={() => setFound(null)}>
                    Cancel
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {groups.map((g) => (
        <section key={g} className="card">
          <div className="ph">
            <h2>{g}</h2>
            <span className="mono">{items.filter((c) => c.group === g).length}</span>
          </div>
          <ul className="nlist">
            {items.map((c, i) =>
              c.group !== g ? null : (
                <li key={c.platform + ':' + c.id} className={c.enabled ? undefined : 'off'}>
                  <label className="lrow flat">
                    <input
                      type="checkbox"
                      aria-label={(c.enabled ? 'Turn off ' : 'Turn on ') + c.name}
                      checked={c.enabled}
                      onChange={(e) =>
                        void save(
                          items.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)),
                          (e.target.checked ? 'Turned on ' : 'Turned off ') + c.name + '.',
                        )
                      }
                    />
                    <span className="tog" />
                  </label>
                  <span className="cname">
                    <b>
                      {c.name}
                      {c.platform === 'rumble' && <span className="badge">Rumble</span>}
                    </b>
                    <small>
                      Tab <b>{c.short}</b> · <span className="mono">{c.id}</span>
                      {checks[c.platform + ':' + c.id] ? ' · ' + checks[c.platform + ':' + c.id] : ''}
                    </small>
                  </span>
                  <span className="actions">
                    <button className="btn small" onClick={() => void check(c)}>
                      Check live
                    </button>
                    <button
                      className="btn small"
                      onClick={() => setEdit({ index: i, name: c.name, short: c.short, group: c.group })}
                    >
                      Edit
                    </button>
                    <button
                      className="btn small"
                      aria-label={'Move ' + c.name + ' up'}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="btn small"
                      aria-label={'Move ' + c.name + ' down'}
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="btn small"
                      aria-label={'Remove ' + c.name}
                      onClick={() => {
                        if (window.confirm('Remove ' + c.name + ' from the channels?'))
                          void save(
                            items.filter((_, j) => j !== i),
                            'Removed ' + c.name + '.',
                          );
                      }}
                    >
                      Remove
                    </button>
                  </span>
                  {edit?.index === i && (
                    <div className="nedit">
                      <div className="aigrid">
                        <label className="field">
                          <span>Name</span>
                          <input
                            value={edit.name}
                            maxLength={80}
                            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Tab label</span>
                          <input
                            value={edit.short}
                            maxLength={24}
                            onChange={(e) => setEdit({ ...edit, short: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Group</span>
                          <input
                            list="channel-groups"
                            value={edit.group}
                            maxLength={40}
                            onChange={(e) => setEdit({ ...edit, group: e.target.value })}
                          />
                        </label>
                      </div>
                      <span className="actions">
                        <button
                          className="btn small primary"
                          onClick={() =>
                            void save(
                              items.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      name: edit.name.trim() || x.name,
                                      short: edit.short.trim() || x.short,
                                      group: edit.group.trim() || x.group,
                                    }
                                  : x,
                              ),
                              'Saved ' + (edit.name.trim() || c.name) + '.',
                            ).then((ok) => ok && setEdit(null))
                          }
                        >
                          Save
                        </button>
                        <button className="btn small" onClick={() => setEdit(null)}>
                          Cancel
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
      {status && <p className="quiet small pad">{status}</p>}
    </>
  );
}
