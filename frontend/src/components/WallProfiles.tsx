import { useEffect, useState } from 'react';

import {
  createWallProfile,
  deleteWallProfile,
  getWallProfiles,
  saveWallProfile,
  type WallPrefs,
  type WallProfile,
} from '../lib/api';
import WallEditor from './WallEditor';

// Settings > Displays > Wall profiles: named wall setups ("Ops floor",
// "Weather desk") that paired screens follow; editing one updates every
// screen on it within a minute.
export default function WallProfiles({ onChange }: { onChange?: () => void }) {
  const [profiles, setProfiles] = useState<WallProfile[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const load = () =>
    getWallProfiles()
      .then((r) => setProfiles(r.profiles))
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load profiles.'));
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await createWallProfile(name.trim(), {});
      setName('');
      await load();
      setEditing(p.id);
      onChange?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not create the profile.');
    }
  }

  async function remove(p: WallProfile) {
    const used = p.screens ? ' ' + p.screens + ' screen(s) use it and will go back to their own settings.' : '';
    if (!window.confirm('Delete the profile "' + p.name + '"?' + used)) return;
    await deleteWallProfile(p.id);
    if (editing === p.id) setEditing(null);
    await load();
    onChange?.();
  }

  const current = profiles?.find((p) => p.id === editing) ?? null;
  return (
    <section className="card">
      <div className="ph">
        <h2>Wall profiles</h2>
        <span className="mono">{profiles?.length ?? '–'}</span>
      </div>
      <div className="cbody">
        <p className="quiet small">
          A profile is a whole wall setup: tour, layers, which sections show, news and clocks. Give each screen a
          profile (below, under Wall settings), or open one on any browser at{' '}
          <span className="mono">/wall?profile=…</span> to preview it.
        </p>
        <ul className="proflist">
          {profiles?.map((p) => (
            <li key={p.id} className={p.id === editing ? 'on' : undefined}>
              <b>{p.name}</b>
              <small className="quiet">
                {p.screens ? p.screens + ' screen' + (p.screens === 1 ? '' : 's') : 'no screens yet'}
              </small>
              <span className="rowbtns">
                <button className="btn small" onClick={() => setEditing(p.id === editing ? null : p.id)}>
                  {p.id === editing ? 'Close' : 'Edit'}
                </button>
                <a className="btn small" href={'/wall?profile=' + p.id} target="_blank" rel="noreferrer">
                  Preview ↗
                </a>
                <button className="btn small" onClick={() => void remove(p)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
          {profiles?.length === 0 && <li className="quiet">No profiles yet.</li>}
        </ul>
        <form className="pairform" onSubmit={(e) => void create(e)}>
          <div className="field">
            <label htmlFor="wp-name">New profile</label>
            <input
              id="wp-name"
              value={name}
              maxLength={60}
              placeholder="Ops floor, Weather desk, Maritime…"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button className="btn" disabled={!name.trim()}>
            Add
          </button>
        </form>
        {status && <p className="quiet small">{status}</p>}
      </div>
      {current && (
        <ProfileEditor
          key={current.id}
          profile={current}
          onSaved={async () => {
            await load();
            onChange?.();
          }}
        />
      )}
    </section>
  );
}

function ProfileEditor({ profile, onSaved }: { profile: WallProfile; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  return (
    <div className="profedit">
      <div className="field pad">
        <label htmlFor="wp-rename">Name</label>
        <input id="wp-rename" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </div>
      <WallEditor
        value={profile.wall}
        onSave={async (wall: WallPrefs) => {
          await saveWallProfile(profile.id, name.trim() || profile.name, wall);
          await onSaved();
        }}
      />
    </div>
  );
}
