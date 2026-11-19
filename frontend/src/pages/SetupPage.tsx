import { type FormEvent, useState } from 'react';

import AuthShell from '../components/AuthShell';
import HomePicker from '../components/HomePicker';
import { api, ApiError, type Home, savePreferences } from '../lib/api';

const STEPS = ['Setup token', 'Admin account', 'Home location', 'Starting layers'];

// What the map shows at first; every layer can be changed later.
const PRESETS = [
  {
    id: 'live',
    label: 'Live picture',
    detail: 'All events, military and civil aircraft, borders and labels',
    prefs: {
      layers: { conflict: true, unrest: true, quake: true, fire: true, hazard: true, maritime: false },
      air: { military: true, civil: true, focus: '' },
      reference: { borders: true, states: false, labels: true, airports: false },
    },
  },
  {
    id: 'events',
    label: 'Events',
    detail: 'Conflict, unrest, earthquakes, fires and disasters; no aircraft',
    prefs: {
      layers: { conflict: true, unrest: true, quake: true, fire: true, hazard: true, maritime: false },
      air: { military: false, civil: false, focus: '' },
      reference: { borders: true, states: true, labels: true, airports: false },
    },
  },
  {
    id: 'air',
    label: 'Air picture',
    detail: 'Military and civil aircraft with airports; events off',
    prefs: {
      layers: { conflict: false, unrest: false, quake: false, fire: false, hazard: false, maritime: false },
      air: { military: true, civil: true, focus: '' },
      reference: { borders: true, states: false, labels: true, airports: true },
    },
  },
  {
    id: 'manual',
    label: 'Start quiet',
    detail: 'Just borders and labels; turn layers on as you need them',
    prefs: {
      layers: { conflict: false, unrest: false, quake: false, fire: false, hazard: false, maritime: false },
      air: { military: false, civil: false, focus: '' },
      reference: { borders: true, states: false, labels: true, airports: false },
    },
  },
] as const;

function strength(pw: string): number {
  let s = 0;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export default function SetupPage({ onDone }: { onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [home, setHome] = useState<Home | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('live');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (step === 0) {
      if (!token.trim()) return setError('Enter the setup token from the server log.');
      return setStep(1);
    }
    if (step === 1) {
      if (!displayName.trim()) return setError('Enter a display name.');
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
        return setError(
          'Usernames are 3–32 characters: letters, numbers, dots, dashes and underscores.',
        );
      }
      if (password.length < 12) return setError('Use a password of at least 12 characters.');
      if (password !== confirm) return setError('The passwords don’t match.');
      return setStep(2);
    }
    if (step === 2) {
      if (!home) return setError('Pick a city or enter coordinates.');
      return setStep(3);
    }
    if (!home) return setStep(2);
    setBusy(true);
    try {
      await api('/api/setup', {
        method: 'POST',
        body: {
          token,
          username,
          display_name: displayName,
          email: email || null,
          password,
          home,
        },
      });
      const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
      // Setup signed us in; the layer choice is an ordinary preference.
      await savePreferences(chosen.prefs).catch(() => undefined);
      await onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup failed.';
      setError(message);
      if (err instanceof ApiError && err.status === 403) setStep(0);
      else if (err instanceof ApiError && /password|username/i.test(message)) setStep(1);
    } finally {
      setBusy(false);
    }
  }

  const s = strength(password);
  return (
    <AuthShell>
      <div className="steps">
        {STEPS.map((label, i) => (
          <span key={label} className={i === step ? 'on' : i < step ? 'done' : ''}>
            {i < step ? '✓ ' : i + 1 + ' '}
            {label}
          </span>
        ))}
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        {step === 0 && (
          <>
            <div>
              <h1>Set up Argus</h1>
              <p>
                No accounts exist yet. To stop anyone else on your network claiming this
                server first, enter the one-time setup token from the API log.
              </p>
            </div>
            <div className="field">
              <label htmlFor="su-token">Setup token</label>
              <input
                id="su-token"
                className="mono"
                autoFocus
                autoComplete="off"
                placeholder="XXXX-XXXX-XXXX"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <span className="hint mono">docker compose logs api | grep "setup token"</span>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div>
              <h1>Create the admin account</h1>
              <p>This account manages users, keys and settings.</p>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="su-name">Display name</label>
                <input
                  id="su-name"
                  autoFocus
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="su-user">Username</label>
                <input
                  id="su-user"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="su-email">Email (optional, for alerts)</label>
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
              <div className="meter">
                <i
                  style={{
                    width: (s / 4) * 100 + '%',
                    background: ['#ff5260', '#ff9447', '#e3c04b', '#4fbf7f', '#4fbf7f'][s],
                  }}
                />
              </div>
              <span className="hint">At least 12 characters. A passphrase of 4+ words works well.</span>
            </div>
            <div className="field">
              <label htmlFor="su-pw2">Confirm password</label>
              <input
                id="su-pw2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div>
              <h1>Where is home?</h1>
              <p>Argus opens here and flags events within your alert radius.</p>
            </div>
            <HomePicker value={home} onChange={setHome} />
          </>
        )}
        {step === 3 && (
          <>
            <div>
              <h1>What should the map show?</h1>
              <p>A starting point. Every layer can be switched in the layer panel later.</p>
            </div>
            <div className="presets" role="radiogroup" aria-label="Starting layers">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.id}
                  className={'preset' + (preset === p.id ? ' on' : '')}
                  onClick={() => setPreset(p.id)}
                >
                  <b>{p.label}</b>
                  <small>{p.detail}</small>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="err" role="alert">
          {error}
        </div>
        <div className="actions spread">
          {step > 0 ? (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {step === 3 ? (busy ? 'Creating…' : 'Finish setup') : 'Continue'}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
