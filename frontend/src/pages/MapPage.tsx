import { useEffect, useRef, useState } from 'react';

import Brand from '../components/Brand';
import { logout, type Me } from '../lib/api';
import Globe, { type GlobeHandle } from '../map/Globe';

function zoneTime(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '--:--:--';
  }
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function MapPage({
  me,
  onSignedOut,
}: {
  me: Me;
  onSignedOut: () => Promise<void>;
}) {
  const now = useClock();
  const globe = useRef<GlobeHandle>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const home = me.preferences.home ?? null;
  const initials = me.user.display_name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  async function signOut() {
    try {
      await logout();
    } finally {
      await onSignedOut();
    }
  }

  return (
    <div className="app">
      <div className="banner">UNCLASSIFIED // OPEN SOURCE</div>
      <header className="cmdbar">
        <Brand />
        <nav className="nav" aria-label="Pages">
          <a href="/" aria-current="page">
            Map
          </a>
          <a href="/docs/">Docs</a>
        </nav>
        <div className="clocks">
          <div className="clock">
            <span className="mono">{now.toISOString().slice(11, 19)}Z</span>
            <small>UTC</small>
          </div>
          {home && (
            <div className="clock">
              <span className="mono">{zoneTime(home.tz)}</span>
              <small>Home</small>
            </div>
          )}
          <div className="umenu">
            <button
              className="avatar"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {initials}
            </button>
            {menuOpen && (
              <ul>
                <li className="who">
                  <b>{me.user.display_name}</b>
                  <br />
                  {me.user.username} · {me.user.role}
                </li>
                <li>
                  <a href="/docs/">Documentation</a>
                </li>
                <li>
                  <button onClick={() => void signOut()}>Sign out</button>
                </li>
              </ul>
            )}
          </div>
        </div>
      </header>
      <main className="mapcell">
        <Globe ref={globe} home={home} />
        <div className="mc tl">
          <div className="seg" role="group" aria-label="Projection">
            {(['3d', '2d'] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  globe.current?.setMode(m);
                }}
              >
                {m === '3d' ? '3D Globe' : '2D World'}
              </button>
            ))}
          </div>
        </div>
        <div className="mc tr">
          <button
            className="iconbtn"
            title={home ? 'Fly home' : 'Reset view'}
            aria-label="Fly home"
            onClick={() => globe.current?.flyHome()}
          >
            ⌂
          </button>
        </div>
        {home && (
          <div className="mc bl">
            <div className="readout">
              <span>HOME</span>
              <b>{home.name}</b>
              <span>LAT/LON</span>
              <b>
                {home.lat.toFixed(4)}, {home.lon.toFixed(4)}
              </b>
              <span>RADIUS</span>
              <b>{home.radius_km} km</b>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
