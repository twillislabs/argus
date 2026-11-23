import { useEffect, useState } from 'react';

import AuthShell from '../components/AuthShell';
import { api, ApiError, logout } from '../lib/api';

// A wall screen pairs here without anyone typing a password on it: it
// shows a code, an admin enters the code in Settings > Displays, and the
// screen signs itself in and opens the wall.
export default function PairPage({ onPaired }: { onPaired: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = 'Pair this screen · Argus';
    let cancelled = false;
    setError('');
    api<{ code: string; token: string; expires_in: number }>('/api/display/pair/start', { method: 'POST' })
      .then((r) => {
        if (cancelled) return;
        setCode(r.code);
        setToken(r.token);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not start pairing.'));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!token) return;
    const id = window.setInterval(() => {
      api<{ status: string }>('/api/display/pair/poll', { method: 'POST', body: { token } })
        .then(async (r) => {
          if (r.status === 'paired') {
            window.clearInterval(id);
            await onPaired();
            window.location.assign('/wall');
          }
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 410) {
            window.clearInterval(id);
            setToken('');
            setAttempt((a) => a + 1);
          }
        });
    }, 3000);
    return () => window.clearInterval(id);
  }, [token, onPaired]);

  return (
    <AuthShell wide>
      <div className="pairbody">
        <span className="eyebrow">Wall display</span>
        <h1>Pair this screen</h1>
        <p>
          In Argus on another device, open <b>Settings › Displays</b> and enter this code. This screen then shows the
          wall.
        </p>
        <div className="paircode mono" aria-live="polite">
          {code ? code.slice(0, 3) + ' ' + code.slice(3) : '······'}
        </div>
        {error ? <p className="err">{error}</p> : <p className="quiet">The code changes every ten minutes.</p>}
      </div>
    </AuthShell>
  );
}

// /pair in a browser that's already signed in: pairing is for a screen
// that isn't, so say how to get there, or where codes are approved.
export function PairSignedIn({ name, onSignedOut }: { name: string; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell wide>
      <div className="pairbody">
        <span className="eyebrow">Wall display</span>
        <h1>Pair a screen</h1>
        <p>
          This browser is signed in as <b>{name}</b>. To make it a wall screen, sign out here (or open{' '}
          <span className="mono">/pair</span> in a private window, or on the screen itself) and it shows a pairing code.
        </p>
        <p>To approve a code shown on another screen, open Settings › Displays.</p>
        <div className="actions">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await logout().catch(() => undefined);
              onSignedOut();
            }}
          >
            Sign out and pair this browser
          </button>
          <a className="btn" href="/settings/displays">
            Settings › Displays
          </a>
        </div>
      </div>
    </AuthShell>
  );
}
