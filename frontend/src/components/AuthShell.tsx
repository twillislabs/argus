import { type ReactNode, useEffect, useState } from 'react';

import AuthGlobe from './AuthGlobe';
import Brand from './Brand';

// What Argus watches, cycled under the name on the sign-in pages.
const WATCHES = [
  'military aircraft',
  'ships and dark vessels',
  'satellites overhead',
  'earthquakes and wildfires',
  'storms and severe weather',
  'conflict and unrest',
  'traffic cameras',
  'breaking news',
];

const pad = (n: number) => String(n).padStart(2, '0');

// wide: a bigger card (the pairing code, read from across a room).
export default function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [watch, setWatch] = useState(0);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const ticker = still ? undefined : window.setInterval(() => setWatch((i) => (i + 1) % WATCHES.length), 2600);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(ticker);
    };
  }, []);
  const utc = pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds()) + 'Z';

  return (
    <div className="app">
      <header className="cmdbar">
        <Brand />
      </header>
      <main className="auth">
        <section className="auth-art" aria-hidden="true">
          <AuthGlobe />
          <span className="bracket tl" />
          <span className="bracket tr" />
          <span className="bracket bl" />
          <span className="bracket br" />
          <div className="auth-readout mono">
            <span className="live">● LIVE</span>
            <span>{utc}</span>
          </div>
          <div className="claim">
            <b>ARGUS</b>
            <span className="watching">
              Watching{' '}
              <em key={watch} className="tick">
                {WATCHES[watch]}
              </em>
            </span>
            <span className="tagline">Self-hosted situational awareness. Your data stays on your server.</span>
          </div>
        </section>
        <section className={'auth-form' + (wide ? ' wide' : '')}>{children}</section>
      </main>
    </div>
  );
}
