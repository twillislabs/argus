import { useEffect, useState } from 'react';

import { type EventDetail, getEvent, ApiError } from '../lib/api';
import { ago, SEVERITY_COLOR, SEVERITY_NAME, TYPE_INFO, zuluTime } from '../lib/format';
import CopyCoords from './CopyCoords';

interface Props {
  id: string;
  onBack: () => void;
  onFly: (lat: number, lon: number) => void;
}

export default function EventInspector({ id, onBack, onFly }: Props) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError('');
    getEvent(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (cancelled) return;
        // Events expire and are pruned; say so rather than "no event".
        if (err instanceof ApiError && err.status === 404) setError('This event is no longer in Argus; it may have expired.');
        else setError(err instanceof Error ? err.message : 'Could not load the event.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      {error && <p className="err pad">{error}</p>}
      {!detail && !error && <p className="quiet pad">Loading…</p>}
      {detail && <Detail d={detail} onFly={onFly} showRaw={showRaw} setShowRaw={setShowRaw} />}
    </div>
  );
}

function Detail({
  d,
  onFly,
  showRaw,
  setShowRaw,
}: {
  d: EventDetail;
  onFly: (lat: number, lon: number) => void;
  showRaw: boolean;
  setShowRaw: (v: boolean) => void;
}) {
  const e = d.event;
  const url = typeof e.data.url === 'string' ? e.data.url : null;
  return (
    <>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: SEVERITY_COLOR[e.severity] }}>
            {SEVERITY_NAME[e.severity]}
          </span>
          <span className="badge">{TYPE_INFO[e.type].label}</span>
          {e.status === 'candidate' && <span className="badge warn">Unconfirmed</span>}
          <span className="badge mono">{e.id}</span>
        </div>
        <h1 className="etitle">{e.title}</h1>
        <div className="sub">{e.place}</div>
        <div className="actions">
          <button className="btn" onClick={() => onFly(e.lat, e.lon)}>
            Fly to
          </button>
          {url && (
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              Source page ↗
            </a>
          )}
        </div>
      </section>
      <section className="isec">
        <p className="prose">{e.summary}</p>
        <dl className="kv">
          <div>
            <dt>First seen</dt>
            <dd>{zuluTime(e.first_seen)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{ago(e.last_updated)}</dd>
          </div>
          <div className="wide">
            <dt>Position</dt>
            <dd>
              <CopyCoords lat={e.lat} lon={e.lon} />
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{Math.round(e.confidence * 100)}%</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>
              {e.source_count}
              {e.article_count ? ' · ' + e.article_count + ' articles' : ''}
            </dd>
          </div>
        </dl>
      </section>
      <section className="isec">
        <h3>Source records · {d.sources.length}</h3>
        <ul className="srclist">
          {d.sources.map((s) => (
            <li key={s.source + s.external_id}>
              <span className="mono">{s.source.toUpperCase()}</span>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {hostOf(s.url) || s.label}
                </a>
              ) : (
                <span>{s.label}</span>
              )}
              <span className="mono dim">{zuluTime(s.observed_at)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="isec">
        <h3>Coverage · {d.articles.length}</h3>
        {d.articles.length ? (
          <ul className="news">
            {d.articles.map((a) => (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.title}
                </a>
                <span className="m">
                  {a.outlet} · {ago(a.published_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">No matching headlines from your news feeds yet.</p>
        )}
      </section>
      <section className="isec">
        <button className="backlink" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Hide' : 'Show'} raw record
        </button>
        {showRaw && <pre className="raw">{JSON.stringify(e, null, 2)}</pre>}
      </section>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
