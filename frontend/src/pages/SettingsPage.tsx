import { useState } from 'react';

import AppHeader from '../components/AppHeader';
import HomePicker from '../components/HomePicker';
import { type Home, type Me, savePreferences } from '../lib/api';

interface Props {
  me: Me;
  onSaved: () => Promise<void>;
  onSignedOut: () => Promise<void>;
}

export default function SettingsPage({ me, onSaved, onSignedOut }: Props) {
  const current = me.preferences.home ?? null;
  const [home, setHome] = useState<Home | null>(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(me.preferences.show_banner === true);

  async function toggleBanner(next: boolean) {
    setBanner(next);
    try {
      await savePreferences({ show_banner: next });
      await onSaved();
    } catch {
      setBanner(!next);
    }
  }

  async function save() {
    if (!home) {
      setMessage({ ok: false, text: 'Pick a place or enter valid coordinates.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await savePreferences({ home });
      await onSaved();
      setMessage({ ok: true, text: 'Saved. The map now opens at ' + home.name + '.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <AppHeader me={me} onSignedOut={onSignedOut} />
      <main className="page">
        <section className="card">
          <div className="ph">
            <h2>Home location</h2>
            <span className="mono">{current ? current.name : 'not set'}</span>
          </div>
          <div className="cbody">
            <p>
              Argus opens at home, shows a home clock and flags events within your alert
              radius.
            </p>
            <HomePicker value={current} onChange={setHome} />
            <div className="actions">
              <button className="btn primary" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : 'Save home'}
              </button>
            </div>
            {message && (
              <div className={message.ok ? 'okmsg' : 'err'} role="status">
                {message.text}
              </div>
            )}
          </div>
        </section>
        <section className="card">
          <div className="ph">
            <h2>Display</h2>
          </div>
          <div className="cbody">
            <label className="lrow flat">
              <input
                type="checkbox"
                checked={banner}
                onChange={(e) => void toggleBanner(e.target.checked)}
              />
              <span className="tog" />
              <span />
              <span className="lname">
                <span>Classification line</span>
                <small>Shows “UNCLASSIFIED // OPEN SOURCE” in a thin strip above the header</small>
              </span>
            </label>
          </div>
        </section>
      </main>
    </div>
  );
}
