import { useEffect, useRef, useState } from 'react';

import { csrfToken } from '../lib/api';

// Settings > Backups (admins): download a full backup, or restore one.
// Both ask for your password. A restore replaces everything, so it also
// asks you to type "restore"; Argus then restarts and you sign in with
// the accounts from the backup.

type Status = { state: 'idle' | 'running' | 'done' | 'failed'; message: string };

function detail(text: string, fallback: string): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    return typeof body.detail === 'string' ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

export default function BackupsSection() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [pw2, setPw2] = useState('');
  const [confirm, setConfirm] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const poll = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(poll.current), []);

  async function download(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote('Making the backup…');
    try {
      const r = await fetch('/api/admin/backup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) throw new Error(detail(await r.text(), 'The backup failed (' + r.status + ').'));
      const blob = await r.blob();
      const name = /filename="?([^";]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'argus-backup.tar.gz';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      setPw('');
      setNote('Saved ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' MB). It holds secrets: keep it safe.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The backup failed.');
    } finally {
      setBusy(false);
    }
  }

  function watch() {
    window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      try {
        const r = await fetch('/api/backup/restore/status', { credentials: 'same-origin' });
        if (!r.ok) return; // restarting
        const s = (await r.json()) as Status;
        setStatus(s);
        if (s.state === 'done') {
          window.clearInterval(poll.current);
          // Give the API a moment to come back, then sign in again.
          window.setTimeout(() => window.location.assign('/'), 6000);
        }
        if (s.state === 'failed') window.clearInterval(poll.current);
      } catch {
        // The API is restarting; keep asking.
      }
    }, 2000);
  }

  function restore(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    setStatus(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/backup/restore');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/gzip');
    xhr.setRequestHeader('X-CSRF-Token', csrfToken());
    xhr.setRequestHeader('X-Argus-Confirm', confirm.trim().toLowerCase());
    xhr.setRequestHeader('X-Argus-Password', pw2);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(ev.loaded / ev.total);
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status === 202) {
        setPw2('');
        setConfirm('');
        setStatus({ state: 'running', message: 'Restoring the backup…' });
        watch();
      } else {
        setError(detail(xhr.responseText, 'The restore failed (' + xhr.status + ').'));
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError('The upload failed. Check the connection and try again.');
    };
    xhr.send(file);
  }

  const restoring = status?.state === 'running' || progress !== null;
  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Download a backup</h2>
        </div>
        <form className="cbody" onSubmit={(e) => void download(e)}>
          <p className="quiet small">
            A full copy of this Argus: accounts, settings, data-source keys, preferences, drawings, events and history,
            plus the secret key that unlocks the stored keys. It holds secrets, so keep it somewhere safe. The same file
            restores here or on another server (or with <span className="mono">make restore</span>).
          </p>
          <div className="pairform">
            <div className="field">
              <label htmlFor="bk-pw">Your password</label>
              <input
                id="bk-pw"
                type="password"
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <button className="btn primary" disabled={busy || !pw}>
              {busy ? 'Working…' : 'Download backup'}
            </button>
          </div>
          {note && <p className="quiet small">{note}</p>}
        </form>
      </section>
      <section className="card">
        <div className="ph">
          <h2>Restore a backup</h2>
        </div>
        <form className="cbody" onSubmit={restore}>
          <p className="err small" style={{ margin: 0 }}>
            Restoring replaces <b>all</b> of this server&apos;s data with the backup&apos;s, including every account.
          </p>
          <p className="quiet small">
            The backup is checked and restored into a fresh database first; this server&apos;s data is only replaced
            once that has worked. Argus then restarts (about a minute) and you sign in with the backup&apos;s accounts.
            Stored data-source keys are moved to this server&apos;s secret key.
          </p>
          <div className="field">
            <label htmlFor="rs-file">Backup file (.tar.gz)</label>
            <input
              id="rs-file"
              type="file"
              accept=".gz,.tgz,application/gzip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="pairform">
            <div className="field">
              <label htmlFor="rs-pw">Your password</label>
              <input
                id="rs-pw"
                type="password"
                autoComplete="current-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="rs-confirm">Type restore</label>
              <input id="rs-confirm" value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button
              className="btn danger"
              disabled={!file || !pw2 || confirm.trim().toLowerCase() !== 'restore' || restoring}
            >
              Restore
            </button>
          </div>
          {progress !== null && <p className="quiet small">Uploading… {Math.round(progress * 100)}%</p>}
          {status && (
            <p className={'small ' + (status.state === 'failed' ? 'err' : 'quiet')}>
              {status.state === 'failed' ? 'The restore failed; nothing was changed. ' : ''}
              {status.message}
              {status.state === 'done' ? ' Taking you to sign in…' : ''}
            </p>
          )}
          {error && <p className="err small">{error}</p>}
        </form>
      </section>
    </>
  );
}
