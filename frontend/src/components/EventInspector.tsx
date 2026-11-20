import { useEffect, useState } from 'react';

import { type EventDetail, getEvent, ApiError, getEventVideo } from '../lib/api';
import { ago, SEVERITY_COLOR, SEVERITY_NAME, TYPE_INFO, zuluTime } from '../lib/format';
import CopyCoords from './CopyCoords';
import { summarizeEvent, useAiStatus } from '../lib/ai';
import VideoList from './VideoList';

interface Props {
  id: string;
  onBack: () => void;
  onFly: (lat: number, lon: number) => void;
}

const CHECK_ORDER = { named: 0, unknown: 1, not_named: 2 } as const;

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
        if (err instanceof ApiError && err.status === 404)
          setError('This event is no longer in Argus; it may have expired.');
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
      <AiSummary id={e.id} />
      <section className="isec">
        <h3>Source records · {d.sources.length}</h3>
        {d.sources.some((s) => s.check) && (
          <p className="quiet small">
            GDELT matches news articles to events automatically, so some can be about something else. Each link is
            checked for the place&apos;s name and the kind of event it was coded as.
          </p>
        )}
        <ul className="srclist">
          {[...d.sources]
            .sort((a, b) => CHECK_ORDER[a.check?.place ?? 'named'] - CHECK_ORDER[b.check?.place ?? 'named'])
            .map((s) => (
              <li key={s.source + s.external_id} className={s.check?.place === 'not_named' ? 'doubtful' : undefined}>
                <span className="mono">{s.source.toUpperCase()}</span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {hostOf(s.url) || s.label}
                  </a>
                ) : (
                  <span>{s.label}</span>
                )}
                <span className="mono dim">{zuluTime(s.observed_at)}</span>
                {s.check && (
                  <span className="srctags">
                    <i className={'tag ' + s.check.place}>
                      {s.check.place === 'named'
                        ? 'names ' + (e.place.split(',')[0] || 'the place')
                        : s.check.place === 'not_named'
                          ? "doesn't name the place"
                          : 'headline not in link'}
                    </i>
                    {!s.check.same_kind && <i className="tag other">coded as {s.label.toLowerCase()}</i>}
                  </span>
                )}
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
        <h3>Video</h3>
        <VideoList
          resetKey={e.id}
          label="Find video about this event"
          empty="No recent videos found for this place and kind of event."
          fetch={() => getEventVideo(e.id)}
        />
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

// One neutral paragraph from the event's sources (Settings > AI >
// Event summaries), on request: it spends the provider's tokens.
function AiSummary({ id }: { id: string }) {
  const status = useAiStatus();
  const [text, setText] = useState<{ summary: string; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setText(null);
    setError('');
  }, [id]);
  if (!status?.features.summaries || !status.can_use) return null;
  return (
    <section className="isec">
      <h3>
        <span className="aibadge">AI</span>Summary
      </h3>
      {text ? (
        <>
          <p className="small">{text.summary}</p>
          <p className="quiet small">Written by AI ({text.model}) from the sources below; check them.</p>
        </>
      ) : (
        <button
          className="btn small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            summarizeEvent(id)
              .then(setText)
              .catch((err) => setError(err instanceof Error ? err.message : 'The summary failed.'))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Summarising…' : 'Summarise the sources'}
        </button>
      )}
      {error && <p className="err small">{error}</p>}
    </section>
  );
}
