import { useEffect, useState } from 'react';

import { type Digest, getDigest } from '../lib/ai';
import { ago } from '../lib/format';

// The Brief's AI digest: a few sentences about the last 24 hours, each
// ending in links to the events it rests on (the server drops any
// sentence without one). Hidden when the feature is off.
export default function DigestCard({ canRefresh }: { canRefresh: boolean }) {
  const [d, setD] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = (refresh: boolean) => {
    setBusy(true);
    setError('');
    getDigest(refresh)
      .then(setD)
      .catch((err) => setError(err instanceof Error ? err.message : 'The digest failed.'))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(false), []);

  if (d?.status === 'off') return null;
  return (
    <section className="card digest">
      <div className="ph">
        <h2>
          <span className="aibadge" title="Written by AI from Argus's events">
            AI
          </span>
          Digest · 24h
        </h2>
        <span className="rowbtns">
          {d?.model && <span className="mono quiet small">{d.model}</span>}
          {canRefresh && (
            <button className="btn small" disabled={busy} onClick={() => load(true)}>
              {busy ? 'Writing…' : 'Refresh'}
            </button>
          )}
        </span>
      </div>
      <div className="cbody">
        {error ? (
          <p className="err small">{error}</p>
        ) : busy && !d?.sentences ? (
          <p className="quiet small">Writing the digest (up to a minute)…</p>
        ) : d?.status === 'none' ? (
          <p className="quiet small">No digest yet: an analyst or admin opening the Brief writes one.</p>
        ) : d?.status === 'empty' ? (
          <p className="quiet small">No events in the last 24 hours to summarise.</p>
        ) : (
          <>
            <p className="digesttext">
              {(d?.sentences ?? []).map((s, i) => (
                <span key={i}>
                  {s.text}
                  {s.cites.map((id) => (
                    <a key={id} className="cite" href={'/#e=' + id} title="Open this event on the map">
                      {id.slice(0, 6)}
                    </a>
                  ))}{' '}
                </span>
              ))}
            </p>
            <p className="quiet small">
              Written by AI from the events below{d?.generated ? ', ' + ago(d.generated) : ''}
              {d?.stale ? ' (an hour or more old)' : ''}. Every sentence links the events it rests on; check them
              before relying on it.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
