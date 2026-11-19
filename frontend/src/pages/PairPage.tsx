import { useEffect, useState } from 'react';

import Brand from '../components/Brand';
import { api, ApiError } from '../lib/api';

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
    <div className="pairpage">
      <Brand />
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
  );
}
