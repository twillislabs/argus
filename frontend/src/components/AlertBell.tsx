import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { type FiredAlert, getAlerts, markRead } from '../lib/alerts';
import { ago, SEVERITY_COLOR } from '../lib/format';

// The header's bell: your alerts (Settings > Alerts), checked every 30 s.
// New ones also show as a browser notification once you allow it.

const supportsNotify = typeof window !== 'undefined' && 'Notification' in window;

export default function AlertBell() {
  const [items, setItems] = useState<FiredAlert[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(supportsNotify ? Notification.permission : 'denied');
  const newest = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Where the dropdown starts on phones, where it spans the screen below
  // the bell (styles/mobile.css) instead of hanging off its left side.
  const [top, setTop] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () =>
      getAlerts(25)
        .then((r) => {
          if (!alive) return;
          const top = r.alerts[0]?.id ?? 0;
          if (newest.current !== null && supportsNotify && Notification.permission === 'granted') {
            for (const a of r.alerts.filter((x) => x.id > (newest.current ?? 0) && !x.read).slice(0, 3)) {
              try {
                new Notification(a.title, { body: a.body, tag: 'argus-' + a.id });
              } catch {
                // Some browsers only allow notifications from a service worker.
              }
            }
          }
          newest.current = Math.max(newest.current ?? 0, top);
          setItems(r.alerts);
          setUnread(r.unread);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  function go(a: FiredAlert) {
    setOpen(false);
    if (!a.read) {
      void markRead([a.id]).catch(() => undefined);
      setItems((xs) => xs.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
    }
    if (a.link?.startsWith('#')) {
      navigate('/');
      window.location.hash = a.link.slice(1);
    } else if (a.link) navigate(a.link);
  }

  return (
    <div className="bell" ref={box}>
      <button
        className={'bellbtn' + (unread ? ' on' : '')}
        aria-label={unread ? unread + ' unread alerts' : 'Alerts'}
        title="Alerts"
        onClick={(e) => {
          setTop(Math.round(e.currentTarget.getBoundingClientRect().bottom) + 8);
          setOpen(!open);
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="bellcount">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="belldrop" role="menu" style={{ '--belltop': top + 'px' } as CSSProperties}>
          <div className="bellhead">
            <b>Alerts</b>
            <span className="rowbtns">
              {unread > 0 && (
                <button
                  className="btn small"
                  onClick={() => {
                    void markRead('all');
                    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
                    setUnread(0);
                  }}
                >
                  Mark all read
                </button>
              )}
              <button
                className="btn small"
                onClick={() => {
                  setOpen(false);
                  navigate('/settings/alerts');
                }}
              >
                Rules
              </button>
            </span>
          </div>
          {supportsNotify && perm === 'default' && (
            <button className="bellperm" onClick={() => void Notification.requestPermission().then((p) => setPerm(p))}>
              Show new alerts as browser notifications while Argus is open
            </button>
          )}
          <ul>
            {items.map((a) => (
              <li key={a.id} className={a.read ? 'read' : undefined}>
                <button onClick={() => go(a)} style={{ ['--c' as string]: SEVERITY_COLOR[a.severity] }}>
                  <b>{a.title}</b>
                  <span>{a.body}</span>
                  <small>
                    {ago(a.created_at)}
                    {a.pushed === 'quiet'
                      ? ' · held by quiet hours'
                      : a.pushed?.includes('failed') || /\d{3}/.test(a.pushed ?? '')
                        ? ' · push: ' + a.pushed
                        : ''}
                  </small>
                </button>
              </li>
            ))}
            {!items.length && (
              <li className="quiet small bellempty">No alerts yet. Set up rules in Settings › Alerts.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
