import { type FormEvent, useEffect, useState } from 'react';

import AuthShell from '../components/AuthShell';
import { api } from '../lib/api';

// Plain http:// on anything but this computer: browsers drop Secure
// cookies there, so a Secure-cookie server can't keep you signed in.
export function insecurePage(): boolean {
  const h = window.location.hostname;
  return window.location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(h);
}

export const COOKIE_HELP =
  'This Argus only signs in over HTTPS (ARGUS_COOKIE_SECURE=true), and this page is plain http://, so your browser ' +
  "won't keep the sign-in. Open Argus through its https:// address, or, for plain-HTTP use on a trusted LAN, set " +
  'ARGUS_COOKIE_SECURE=false in .env and restart (make up).';

export default function LoginPage({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secureCookies, setSecureCookies] = useState(false);
  useEffect(() => {
    api<{ secure_cookies?: boolean }>('/api/setup/status')
      .then((s) => setSecureCookies(Boolean(s.secure_cookies)))
      .catch(() => undefined);
  }, []);

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
      // The password was right; did the browser keep the session?
      try {
        await api('/api/me');
      } catch {
        setError(
          insecurePage()
            ? COOKIE_HELP
            : "Signed in, but your browser didn't keep the session cookie. Allow cookies for this site and try again.",
        );
        setPassword('');
        return;
      }
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
      {secureCookies && insecurePage() && <p className="err small">{COOKIE_HELP}</p>}
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
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this device for 30 days
        </label>
        <div className="err" role="alert">
          {error}
        </div>
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="pairlink quiet small">
        A TV or wall screen? <a href="/pair">Pair it as a wall display</a>: it shows a code for an admin to approve,
        and no one signs in on it.
      </p>
    </AuthShell>
  );
}
