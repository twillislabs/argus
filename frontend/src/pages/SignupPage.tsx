import { type FormEvent, useEffect, useState } from 'react';

import AuthShell from '../components/AuthShell';
import { api } from '../lib/api';

// Make an account, when an admin allows sign-ups (Settings › Users ›
// Sign-ups). With approval on, the account waits until an admin
// approves it; without, you're signed in straight away.
export default function SignupPage({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    document.title = 'Create an account · Argus';
    api<{ signup?: boolean }>('/api/setup/status')
      .then((s) => setOpen(Boolean(s.signup)))
      .catch(() => setOpen(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ status: 'pending' | 'signed_in' }>('/api/auth/signup', {
        method: 'POST',
        body: {
          username: username.trim(),
          display_name: displayName.trim() || username.trim(),
          email: email.trim() || null,
          password,
        },
      });
      if (r.status === 'pending') setWaiting(true);
      else await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div>
        <span className="eyebrow">Sign up</span>
        <h1>Create an account</h1>
      </div>
      {open === null ? (
        <p className="quiet">Loading…</p>
      ) : !open ? (
        <>
          <p className="quiet">This Argus doesn&apos;t take sign-ups. Ask an administrator for an account.</p>
          <a className="btn" href="/login">
            Back to sign in
          </a>
        </>
      ) : waiting ? (
        <>
          <p>
            Your account <b>{username.trim().toLowerCase()}</b> is made and waiting for an administrator to approve it.
            Once they have, sign in with the password you chose.
          </p>
          <a className="btn primary" href="/login">
            Go to sign in
          </a>
        </>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="su-user">Username</label>
            <input
              id="su-user"
              autoFocus
              autoComplete="username"
              value={username}
              maxLength={32}
              onChange={(e) => setUsername(e.target.value)}
            />
            <small className="quiet">3 to 32 letters, digits, dots, dashes or underscores.</small>
          </div>
          <div className="field">
            <label htmlFor="su-name">Your name</label>
            <input
              id="su-name"
              autoComplete="name"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="su-email">Email (optional)</label>
            <input
              id="su-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="su-pw">Password</label>
            <input
              id="su-pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="su-pw2">Password again</label>
            <input
              id="su-pw2"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
          <div className="err" role="alert">
            {error}
          </div>
          <button
            type="submit"
            className="btn primary wide"
            disabled={busy || username.trim().length < 3 || !password || !again}
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className="quiet small">
            Already have one? <a href="/login">Sign in</a>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
