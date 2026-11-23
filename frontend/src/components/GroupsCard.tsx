import { useCallback, useEffect, useState } from 'react';

import {
  type AccessFeature,
  type AccessRule,
  type AdminUser,
  deleteGroup,
  editGroup,
  getAccess,
  getGroups,
  listUsers,
  makeGroup,
  putAccess,
  type UserGroupRow,
} from '../lib/api';

// Settings › Users & roles: user groups, and limiting some features (AI,
// alerts, API tokens, video search) to chosen groups and people. A
// feature's role still has to allow it; admins always keep everything.

const blank = { id: 0, name: '', description: '', members: [] as number[] };

export default function GroupsCard({ onSaved }: { onSaved?: () => Promise<void> }) {
  const [groups, setGroups] = useState<UserGroupRow[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [features, setFeatures] = useState<AccessFeature[]>([]);
  const [rules, setRules] = useState<Record<string, AccessRule>>({});
  const [editing, setEditing] = useState<typeof blank | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const [g, u, a] = await Promise.all([getGroups(), listUsers(), getAccess()]);
      setGroups(g.groups);
      setUsers(u.filter((x) => x.role !== 'display'));
      setFeatures(a.features);
      setRules(a.rules);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not load groups.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function saveGroup() {
    if (!editing) return;
    const body = {
      name: editing.name.trim(),
      description: editing.description.trim() || null,
      members: editing.members,
    };
    try {
      if (editing.id) await editGroup(editing.id, body);
      else await makeGroup(body);
      setEditing(null);
      setStatus('Saved ' + body.name + '.');
      await load();
      await onSaved?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save the group.');
    }
  }

  async function remove(g: UserGroupRow) {
    if (!window.confirm('Delete the group ' + g.name + '? Features limited to it lose these people.')) return;
    try {
      await deleteGroup(g.id);
      await load();
      await onSaved?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not delete it.');
    }
  }

  async function saveRule(feature: string, rule: AccessRule) {
    const before = rules;
    const next = { ...rules, [feature]: rule };
    setRules(next);
    try {
      const r = await putAccess(next);
      setRules(r.rules);
      setStatus('Saved.');
      await onSaved?.();
    } catch (err) {
      setRules(before);
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  if (!groups) return <p className="quiet pad">{status || 'Loading…'}</p>;
  const name = (id: number) => users.find((u) => u.id === id)?.display_name ?? 'user ' + id;
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Groups</h2>
          <span className="mono">{groups.length}</span>
        </div>
        <div className="cbody">
          <p className="quiet small">
            Put people in groups to give a group a feature below (for example, AI only for the analysts on duty).
          </p>
          {groups.length > 0 && (
            <ul className="tokenlist">
              {groups.map((g) => (
                <li key={g.id}>
                  <span>
                    <b>{g.name}</b>
                    <small className="quiet">
                      {g.members.length ? g.members.map(name).join(', ') : 'No one yet'}
                      {g.description ? ' · ' + g.description : ''}
                    </small>
                  </span>
                  <span className="actions">
                    <button
                      className="btn small"
                      onClick={() =>
                        setEditing({ id: g.id, name: g.name, description: g.description ?? '', members: g.members })
                      }
                    >
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => void remove(g)}>
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {editing ? (
            <div className="groupedit">
              <div className="pairform">
                <div className="field">
                  <label htmlFor="gr-name">Name</label>
                  <input
                    id="gr-name"
                    value={editing.name}
                    maxLength={60}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="gr-desc">Description (optional)</label>
                  <input
                    id="gr-desc"
                    value={editing.description}
                    maxLength={200}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  />
                </div>
              </div>
              <fieldset className="pickpeople">
                <legend className="small quiet">Members</legend>
                {users.map((u) => (
                  <label key={u.id} className="check">
                    <input
                      type="checkbox"
                      checked={editing.members.includes(u.id)}
                      onChange={() => setEditing({ ...editing, members: toggle(editing.members, u.id) })}
                    />
                    {u.display_name} <span className="quiet mono small">{u.username}</span>
                  </label>
                ))}
              </fieldset>
              <span className="actions">
                <button className="btn small primary" disabled={!editing.name.trim()} onClick={() => void saveGroup()}>
                  {editing.id ? 'Save group' : 'Add group'}
                </button>
                <button className="btn small" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </span>
            </div>
          ) : (
            <button className="btn small" onClick={() => setEditing({ ...blank })}>
              New group
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="ph">
          <h2>Feature access</h2>
        </div>
        <div className="cbody">
          <p className="quiet small">
            Each feature is open to everyone whose role has it, or only to the groups and people you choose (their role
            must still have it). Administrators always keep every feature.
          </p>
          {features.map((f) => {
            const rule = rules[f.id] ?? { mode: 'role', groups: [], users: [] };
            return (
              <div key={f.id} className="accessrow">
                <div className="srow-label">
                  <b>{f.label}</b>
                  <small>
                    {f.description} Roles: {f.roles.join(', ')}.
                  </small>
                </div>
                <div className="seg small" role="group" aria-label={'Who may use ' + f.label}>
                  <button
                    aria-pressed={rule.mode === 'role'}
                    onClick={() => void saveRule(f.id, { ...rule, mode: 'role' })}
                  >
                    Everyone in those roles
                  </button>
                  <button
                    aria-pressed={rule.mode === 'only'}
                    onClick={() => void saveRule(f.id, { ...rule, mode: 'only' })}
                  >
                    Only chosen
                  </button>
                </div>
                {rule.mode === 'only' && (
                  <div className="chips">
                    {groups.map((g) => (
                      <button
                        key={'g' + g.id}
                        className={'chip' + (rule.groups.includes(g.id) ? ' on' : '')}
                        aria-pressed={rule.groups.includes(g.id)}
                        onClick={() => void saveRule(f.id, { ...rule, groups: toggle(rule.groups, g.id) })}
                      >
                        {g.name}
                      </button>
                    ))}
                    {users
                      .filter((u) => u.role !== 'admin')
                      .map((u) => (
                        <button
                          key={'u' + u.id}
                          className={'chip person' + (rule.users.includes(u.id) ? ' on' : '')}
                          aria-pressed={rule.users.includes(u.id)}
                          onClick={() => void saveRule(f.id, { ...rule, users: toggle(rule.users, u.id) })}
                        >
                          {u.display_name}
                        </button>
                      ))}
                    {!rule.groups.length && !rule.users.length && (
                      <small className="warn">No one but administrators can use it now.</small>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {status && <p className="quiet small">{status}</p>}
        </div>
      </section>
    </>
  );
}
