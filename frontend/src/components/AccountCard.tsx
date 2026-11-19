import { type FormEvent, useState } from 'react';

import { can, changePassword, type Me, updateProfile } from '../lib/api';

// Your own profile and password.
export default function AccountCard({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const editable = can(me.user, 'account.edit');
  const [name, setName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveProfile() {
    setBusy(true);
    setProfileMsg(null);
    try {
      await updateProfile({ display_name: name.trim(), email: email.trim() || null });
      await onSaved();
      setProfileMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (next !== again) {
      setPwMsg({ ok: false, text: "The new passwords don't match." });
      return;
    }
    setBusy(true);
    setPwMsg(null);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setPwMsg({ ok: true, text: 'Password changed. Your other devices were signed out.' });
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not change it.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="ph">
        <h2>Account</h2>
        <span className="mono">
          {me.user.username} · {me.user.role}
        </span>
      </div>
      <div className="cbody">
        {!editable ? (
          <p className="quiet">This is a display account. An administrator manages its details and password.</p>
        ) : (
          <>
            <div className="row2">
              <div className="field">
                <label htmlFor="ac-name">Display name</label>
                <input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ac-email">Email (optional)</label>
                <input id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button className="btn" disabled={busy || !name.trim()} onClick={() => void saveProfile()}>
                Save profile
              </button>
            </div>
            {profileMsg && (
              <div className={profileMsg.ok ? 'okmsg' : 'err'} role="status">
                {profileMsg.text}
              </div>
            )}
            <form className="stack" onSubmit={savePassword} noValidate>
              <input type="text" autoComplete="username" value={me.user.username} readOnly hidden />
              <div className="row2">
                <div className="field">
                  <label htmlFor="ac-cur">Current password</label>
                  <input
                    id="ac-cur"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </div>
                <div />
                <div className="field">
                  <label htmlFor="ac-new">New password</label>
                  <input
                    id="ac-new"
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ac-again">New password again</label>
                  <input
                    id="ac-again"
                    type="password"
                    autoComplete="new-password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions">
                <button type="submit" className="btn" disabled={busy || !current || !next}>
                  Change password
                </button>
              </div>
              {pwMsg && (
                <div className={pwMsg.ok ? 'okmsg' : 'err'} role="status">
                  {pwMsg.text}
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </section>
  );
}
