import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { ApiError, getMe, getSetupStatus, type Me } from './lib/api';
import { stashShareLink } from './lib/share';

// Keep a share link through the sign-in redirect.
stashShareLink();
import BriefPage from './pages/BriefPage';
import PairPage from './pages/PairPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import LoginPage from './pages/LoginPage';
import MapPage from './pages/MapPage';
import NewsPage from './pages/NewsPage';
import WallPage from './pages/WallPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import { setUnits } from './lib/units';
import { setVideoPrefs } from './lib/video';
import Tooltips from './components/Tooltips';

type Boot =
  | { state: 'loading' }
  | { state: 'setup' }
  | { state: 'signedOut' }
  | { state: 'signedIn'; me: Me }
  | { state: 'error'; message: string };

// The tab title for each page, set on every navigation (pages that
// leave nothing behind would otherwise keep the last page's title).
const PAGE_TITLES: Record<string, string> = {
  '': 'Argus',
  settings: 'Settings · Argus',
  brief: 'Brief · Argus',
  wall: 'Wall · Argus',
  pair: 'Pair this screen · Argus',
  login: 'Sign in · Argus',
  setup: 'Set up · Argus',
};

function pageTitle(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'news') return null; // NewsPage names its channel
  if (parts[0] === 'settings' && parts[1]) {
    const section = decodeURIComponent(parts[1]).replace(/-/g, ' ');
    return section.charAt(0).toUpperCase() + section.slice(1) + ' · Settings · Argus';
  }
  return PAGE_TITLES[parts[0] ?? ''] ?? 'Argus';
}

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      const status = await getSetupStatus();
      if (status.needs_setup) {
        setBoot({ state: 'setup' });
        return;
      }
      setBoot({ state: 'signedIn', me: await getMe() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setBoot({ state: 'signedOut' });
      } else {
        setBoot({
          state: 'error',
          message: err instanceof Error ? err.message : 'Argus could not reach its API.',
        });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const title = pageTitle(location.pathname);
    if (title) document.title = title;
  }, [location.pathname]);

  if (boot.state === 'loading') {
    return <div className="boot">Connecting to Argus…</div>;
  }
  if (boot.state === 'error') {
    return (
      <div className="boot">
        <p>{boot.message}</p>
        <button className="btn" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  const path = location.pathname;
  if (boot.state === 'setup' && path !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  // A wall screen pairs at /pair without signing in.
  if (boot.state === 'signedOut' && path === '/pair') {
    return <PairPage onPaired={refresh} />;
  }
  if (boot.state === 'signedOut' && path !== '/login') {
    return <Navigate to="/login" replace />;
  }
  // Display accounts (wall screens) only show the wall.
  if (boot.state === 'signedIn' && boot.me.user.role === 'display' && path !== '/wall') {
    return <Navigate to="/wall" replace />;
  }
  if (boot.state === 'signedIn' && (path === '/login' || path === '/setup')) {
    return <Navigate to="/" replace />;
  }

  // Display units for every page (Settings > Display).
  if (boot.state === 'signedIn') {
    setUnits(boot.me.preferences.units);
    setVideoPrefs(boot.me.preferences.video, boot.me.defaults?.video);
  }

  // A temporary password must be replaced before anything else.
  if (boot.state === 'signedIn' && boot.me.user.must_change_password) {
    return <ChangePasswordPage me={boot.me} onDone={refresh} />;
  }

  return (
    <>
      <Tooltips />
      <Routes>
        <Route path="/setup" element={<SetupPage onDone={refresh} />} />
        <Route path="/login" element={<LoginPage onDone={refresh} />} />
        <Route path="/" element={boot.state === 'signedIn' ? <MapPage me={boot.me} onSignedOut={refresh} /> : null} />
        <Route
          path="/settings/:section?"
          element={
            boot.state === 'signedIn' ? <SettingsPage me={boot.me} onSaved={refresh} onSignedOut={refresh} /> : null
          }
        />
        <Route
        path="/brief"
        element={boot.state === 'signedIn' ? <BriefPage me={boot.me} onSignedOut={refresh} /> : null}
      />
      <Route path="/wall" element={boot.state === 'signedIn' ? <WallPage me={boot.me} /> : null} />
      <Route path="/news" element={boot.state === 'signedIn' ? <NewsPage /> : null} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
