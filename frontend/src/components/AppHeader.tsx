import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import AlertBell from './AlertBell';

import { can, logout, type Me } from '../lib/api';
import { zoneTime } from '../lib/format';
import type { LiveState } from '../lib/live';
import Brand from './Brand';

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

interface Props {
  me: Me;
  onSignedOut: () => Promise<void>;
  live?: LiveState;
  // The map page's search, shown in the bar as in the mock-up.
  search?: ReactNode;
  // The map is showing the past (timeline replay).
  replay?: boolean;
}

export default function AppHeader({ me, onSignedOut, live, search, replay }: Props) {
  const now = useClock();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const home = me.preferences.home ?? null;
  const initials = me.user.display_name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  async function signOut() {
    try {
      await logout();
    } finally {
      await onSignedOut();
    }
  }

  return (
    <>
      {me.preferences.show_banner === true && (
        <div className="banner">UNCLASSIFIED // OPEN SOURCE</div>
      )}
      <header className="cmdbar">
        <Brand />
        <nav className="nav" aria-label="Pages">
          <Link to="/" aria-current={pathname === '/' ? 'page' : undefined}>
            Map
          </Link>
          <Link to="/brief" aria-current={pathname === '/brief' ? 'page' : undefined}>
            Brief
          </Link>
          <Link to="/wall" aria-current={pathname === '/wall' ? 'page' : undefined}>
            Wall
          </Link>
          <Link to="/settings" aria-current={pathname.startsWith('/settings') ? 'page' : undefined}>
            Settings
          </Link>
        </nav>
        {search}
        <div className="clocks">
          {can(me.user, 'alerts.use') && <AlertBell />}
          {live && (
            <span
              className={'livepill ' + (replay ? 'replay' : live)}
              title={replay ? 'Showing the past: press Live under the map to return' : 'Live updates'}
            >
              <i />
              {replay ? 'REPLAY' : live === 'live' ? 'LIVE' : live === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
            </span>
          )}
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
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
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
                  <Link to="/settings">Settings</Link>
                </li>
                <li>
                  <a href="/docs/">Documentation</a>
                </li>
                <li>
                  <button onClick={() => void signOut()}>Sign out</button>
                </li>
                <li className="menuver quiet small">Argus {ARGUS_VERSION}</li>
              </ul>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
