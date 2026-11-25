import { type FormEvent, useState } from 'react';

import AuthShell from '../components/AuthShell';
import { changePassword, logout, type Me } from '../lib/api';

// Shown instead of the app when an admin set a temporary password: the
// server refuses everything else until it's replaced.
export default function ChangePasswordPage({ me, onDone }: { me: Me; onDone: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div>
        <span className="eyebrow">Welcome, {me.user.display_name}</span>
        <h1>Choose your password</h1>
        <p className="quiet">
          You signed in with a temporary password from an administrator. Choose your own to continue: at least 12
          characters; a passphrase works well.
        </p>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        <input type="text" autoComplete="username" value={me.user.username} readOnly hidden />
        <div className="field">
          <label htmlFor="cp-cur">Temporary password</label>
          <input
            id="cp-cur"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="cp-new">New password</label>
          <input
            id="cp-new"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="cp-again">New password again</label>
          <input
            id="cp-again"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </div>
        <div className="err" role="alert">
          {error}
        </div>
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? 'Saving…' : 'Set password and continue'}
        </button>
        <button type="button" className="backlink" onClick={() => void logout().finally(() => void onDone())}>
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
