import { type FormEvent, useCallback, useEffect, useState } from 'react';

import {
  type AdminUser,
  createUser,
  deleteUser,
  listUsers,
  type Me,
  resetUserPassword,
  ROLE_INFO,
  type Role,
  unlockUser,
  updateUser,
} from '../lib/api';
import { ago } from '../lib/format';

const ROLES = Object.keys(ROLE_INFO) as Role[];

// Admins: add people, set roles, reset passwords, deactivate or delete.
export default function UsersCard({ me }: { me: Me }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<{ username: string; password: string; reason: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', display_name: '', email: '', role: 'viewer' as Role });

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That failed.');
      await load();
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await createUser({
        username: form.username.trim(),
        display_name: form.display_name.trim() || form.username.trim(),
        email: form.email.trim() || undefined,
        role: form.role,
      });
      setIssued({ username: r.user.username, password: r.temporary_password, reason: 'Account created.' });
      setCopied(false);
      setForm({ username: '', display_name: '', email: '', role: 'viewer' });
      setAdding(false);
    });
  }

  async function reset(u: AdminUser) {
    if (!window.confirm('Reset the password for ' + u.username + '? They will be signed out everywhere.')) return;
    await run(async () => {
      const r = await resetUserPassword(u.id);
      setIssued({ username: u.username, password: r.temporary_password, reason: 'Password reset.' });
      setCopied(false);
    });
  }

  async function remove(u: AdminUser) {
    if (!window.confirm('Delete ' + u.username + '? This cannot be undone. Deactivate instead to keep the account.'))
      return;
    await run(() => deleteUser(u.id));
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const locked = (u: AdminUser) => Boolean(u.locked_until && Date.parse(u.locked_until) > Date.now());

  return (
    <section className="card wide">
      <div className="ph">
        <h2>Accounts</h2>
        <span className="mono">
          {users.length} {users.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>
      <div className="cbody">
        {issued && (
          <div className="issued" role="status">
            <div>
              <b>{issued.reason}</b> Give <span className="mono">{issued.username}</span> this temporary
              password. It&apos;s shown only once; they choose their own when they first sign in.
            </div>
            <div className="issued-pw">
              <code>{issued.password}</code>
              <button className="btn small" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn small" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>
          </div>
        )}
        <div className="utable" role="table" aria-label="Users">
          <div className="urow head" role="row">
            <span role="columnheader">User</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Last sign-in</span>
            <span role="columnheader" />
          </div>
          {users.map((u) => {
            const self = u.id === me.user.id;
            return (
              <div key={u.id} className={'urow' + (u.is_active ? '' : ' off')} role="row">
                <span className="uname" role="cell">
                  <b>{u.display_name}</b>
                  <small className="mono">
                    {u.username}
                    {u.email ? ' · ' + u.email : ''}
                    {self ? ' · you' : ''}
                  </small>
                </span>
                <span role="cell">
                  <select
                    aria-label={'Role for ' + u.username}
                    value={u.role}
                    disabled={self}
                    title={self ? "You can't change your own role" : ROLE_INFO[u.role].detail}
                    onChange={(e) => void run(() => updateUser(u.id, { role: e.target.value as Role }))}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_INFO[r].label}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="ustatus" role="cell">
                  {!u.is_active ? (
                    <span className="badge">Deactivated</span>
                  ) : locked(u) ? (
                    <span className="badge warn">Locked</span>
                  ) : u.must_change_password ? (
                    <span
                      className="badge"
                      style={{ ['--c' as string]: 'var(--accent)' }}
                      title="Signed in with a temporary password, or hasn't signed in yet"
                    >
                      Temp password
                    </span>
                  ) : (
                    <span className="badge" style={{ ['--c' as string]: 'var(--ok)' }}>
                      Active
                    </span>
                  )}
                </span>
                <span className="mono dim" role="cell">
                  {u.last_login_at ? ago(u.last_login_at) : 'never'}
                </span>
                <span className="uactions" role="cell">
                  {locked(u) && (
                    <button className="btn small" onClick={() => void run(() => unlockUser(u.id))}>
                      Unlock
                    </button>
                  )}
                  {!self && (
                    <>
                      <button className="btn small" onClick={() => void reset(u)}>
                        Reset password
                      </button>
                      <button
                        className="btn small"
                        onClick={() => void run(() => updateUser(u.id, { is_active: !u.is_active }))}
                      >
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button className="btn small danger" onClick={() => void remove(u)}>
                        Delete
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}
        {adding ? (
          <form className="stack" onSubmit={add} noValidate>
            <div className="row2">
              <div className="field">
                <label htmlFor="nu-user">Username</label>
                <input
                  id="nu-user"
                  autoComplete="off"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="nu-name">Display name</label>
                <input
                  id="nu-name"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="nu-email">Email (optional)</label>
                <input
                  id="nu-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="nu-role">Role</label>
                <select
                  id="nu-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_INFO[r].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="quiet small">{ROLE_INFO[form.role].detail}.</p>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={form.username.trim().length < 3}>
                Create account
              </button>
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button className="btn primary" onClick={() => setAdding(true)}>
              Add user
            </button>
          </div>
        )}
        <dl className="roles">
          {ROLES.map((r) => (
            <div key={r}>
              <dt>{ROLE_INFO[r].label}</dt>
              <dd>{ROLE_INFO[r].detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
