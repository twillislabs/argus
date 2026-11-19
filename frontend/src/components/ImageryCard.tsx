import { useEffect, useState } from 'react';

import { getImagerySettings, type ImagerySettings, saveImagerySettings } from '../lib/api';

// Admins only: the server-wide imagery provider. Every user's map uses it.
export default function ImageryCard() {
  const [current, setCurrent] = useState<ImagerySettings | null>(null);
  const [provider, setProvider] = useState<'esri' | 'google'>('esri');
  const [key, setKey] = useState('');
  const [threeD, setThreeD] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getImagerySettings()
      .then((s) => {
        setCurrent(s);
        setProvider(s.provider);
        setThreeD(s.google_3d);
      })
      .catch((err) => setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not load.' }));
  }, []);

  async function save(removeKey = false) {
    setBusy(true);
    setMessage(null);
    try {
      const body: { provider: 'esri' | 'google'; google_key?: string; google_3d: boolean } = {
        provider: removeKey ? 'esri' : provider,
        google_3d: !removeKey && provider === 'google' && threeD,
      };
      if (removeKey) body.google_key = '';
      else if (key.trim()) body.google_key = key.trim();
      const next = await saveImagerySettings(body);
      setCurrent(next);
      setProvider(next.provider);
      setThreeD(next.google_3d);
      setKey('');
      setMessage({
        ok: true,
        text: removeKey
          ? 'Key removed. Maps use Esri.'
          : 'Saved. Maps use ' + (next.provider === 'google' ? 'Google' : 'Esri') + ' after a reload.',
      });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="ph">
        <h2>Imagery provider</h2>
        <span className="mono">{current ? (current.provider === 'google' ? 'Google' : 'Esri') : ''}</span>
      </div>
      <div className="cbody">
        <p>
          Satellite and Hybrid use Esri by default, with no key. With a Google Maps Platform key
          they use Google&apos;s imagery instead, and you can turn on Google&apos;s photorealistic
          3D cities. The Dark map and the self-hosted street map are unchanged.
        </p>
        <div className="seg" role="group" aria-label="Imagery provider">
          {(['esri', 'google'] as const).map((p) => (
            <button key={p} aria-pressed={provider === p} onClick={() => setProvider(p)}>
              {p === 'esri' ? 'Esri (no key)' : 'Google'}
            </button>
          ))}
        </div>
        {provider === 'google' && (
          <>
            <div className="field">
              <label htmlFor="g-key">Google Maps API key</label>
              <input
                id="g-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                placeholder={
                  current?.google_key_set
                    ? 'Saved key ' + (current.google_key_hint ?? '') + ' (leave blank to keep it)'
                    : 'Paste the key'
                }
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            {current?.google_key_unreadable && (
              <p className="err">
                The saved key can&apos;t be read, probably because ARGUS_SECRET_KEY changed. Enter
                it again.
              </p>
            )}
            <label className="lrow flat">
              <input type="checkbox" checked={threeD} onChange={(e) => setThreeD(e.target.checked)} />
              <span className="tog" />
              <span />
              <span className="lname">
                <span>Photorealistic 3D</span>
                <small>Adds a 3D base map: Google&apos;s 3D buildings and terrain, where available</small>
              </span>
            </label>
            <ul className="notes">
              <li>
                Enable the <b>Map Tiles API</b> for the key&apos;s project. Google bills that account
                for tile use beyond its free monthly allowance.
              </li>
              <li>
                The key is stored encrypted, but signed-in browsers receive it to load Google tiles.
                In the Google Cloud console, restrict it to the Map Tiles API and to this
                site&apos;s address.
              </li>
              <li>Using Google tiles means following Google&apos;s Map Tiles API terms.</li>
            </ul>
          </>
        )}
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Checking…' : 'Save imagery'}
          </button>
          {current?.google_key_set && (
            <button className="btn" disabled={busy} onClick={() => void save(true)}>
              Remove key
            </button>
          )}
        </div>
        {message && (
          <div className={message.ok ? 'okmsg' : 'err'} role="status">
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}
