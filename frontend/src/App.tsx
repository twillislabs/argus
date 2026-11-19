import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { ApiError, getMe, getSetupStatus, type Me } from './lib/api';
import ChangePasswordPage from './pages/ChangePasswordPage';
import LoginPage from './pages/LoginPage';
import MapPage from './pages/MapPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';

type Boot =
  | { state: 'loading' }
  | { state: 'setup' }
  | { state: 'signedOut' }
  | { state: 'signedIn'; me: Me }
  | { state: 'error'; message: string };

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
          message:
            err instanceof Error ? err.message : 'Argus could not reach its API.',
        });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
  if (boot.state === 'signedOut' && path !== '/login') {
    return <Navigate to="/login" replace />;
  }
  if (boot.state === 'signedIn' && (path === '/login' || path === '/setup')) {
    return <Navigate to="/" replace />;
  }

  // A temporary password must be replaced before anything else.
  if (boot.state === 'signedIn' && boot.me.user.must_change_password) {
    return <ChangePasswordPage me={boot.me} onDone={refresh} />;
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage onDone={refresh} />} />
      <Route path="/login" element={<LoginPage onDone={refresh} />} />
      <Route
        path="/"
        element={
          boot.state === 'signedIn' ? (
            <MapPage me={boot.me} onSignedOut={refresh} />
          ) : null
        }
      />
      <Route
        path="/settings"
        element={
          boot.state === 'signedIn' ? (
            <SettingsPage me={boot.me} onSaved={refresh} onSignedOut={refresh} />
          ) : null
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
