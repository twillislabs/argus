import { type FormEvent, useState } from 'react';

import AuthShell from '../components/AuthShell';
import { api } from '../lib/api';

export default function LoginPage({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: { username, password, remember },
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div>
        <span className="eyebrow">Sign in</span>
        <h1>Welcome back</h1>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="lg-user">Username</label>
          <input
            id="lg-user"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="lg-pw">Password</label>
          <input
            id="lg-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Keep me signed in on this device for 30 days
        </label>
        <div className="err" role="alert">
          {error}
        </div>
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
