import { useEffect, useState } from 'react';

import { api, type Article } from '../lib/api';
import { ago } from '../lib/format';
import { FAA_COLOR, faaLevel, faaLine, type FaaStatus, getFaaStatus } from '../lib/faa';
import CopyCoords from './CopyCoords';

// An airport or port from the reference layers: what it is, where, and
// recent headlines from your news feeds that name it.

export interface PlaceItem {
  kind: 'airport' | 'seaport' | 'port';
  code: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
}

const KIND_LABEL = { airport: 'Airport', seaport: 'Sea port', port: 'River or inland port' };
const KIND_COLOR = { airport: '#b4c2d4', seaport: '#4fc1b0', port: '#4fc1b0' };

// Words headlines rarely use with a name ("Heathrow", not "London
// Heathrow International Airport").
const FILLER =
  /\b(international|intercontinental|regional|municipal|airport|airfield|aeropuerto|aeroporto|aéroport|flughafen|port of)\b/gi;

// What to search the headlines for: the name without filler and
// brackets, and its longest word when that's different (headlines say
// "Atlanta airport", not "Hartsfield-Jackson Atlanta").
export function searchTerms(name: string): string[] {
  const core = name
    .replace(/\(.*?\)/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (core.length < 3) return [];
  const longest = core.split(/[\s–\-/]+/).sort((a, b) => b.length - a.length)[0] ?? '';
  return [...new Set([core, longest].filter((t) => t.length >= 4))];
}

export default function PlaceInspector({
  place,
  onBack,
  onFly,
  faa,
}: {
  place: PlaceItem;
  onBack: () => void;
  onFly: () => void;
  // The map's copy, when it has one (the airports layer polls it).
  faa?: FaaStatus | null;
}) {
  const [ownFaa, setOwnFaa] = useState<FaaStatus | null>(null);
  const status = faa ?? ownFaa;
  useEffect(() => {
    if (place.kind !== 'airport' || faa) return;
    getFaaStatus()
      .then(setOwnFaa)
      .catch(() => setOwnFaa({ updated: null, airports: {}, status: 'error' }));
  }, [place.kind, place.code, faa]);
  const [articles, setArticles] = useState<Article[] | null>(null);
  const terms = searchTerms(place.name);
  const key = place.kind + place.code;

  useEffect(() => {
    let cancelled = false;
    setArticles(null);
    Promise.all(
      terms.map((q) =>
        api<{ articles: Article[] }>('/api/news?limit=15&q=' + encodeURIComponent(q))
          .then((r) => r.articles)
          .catch(() => [] as Article[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const seen = new Map<number, Article>();
      for (const a of lists.flat()) seen.set(a.id, a);
      setArticles([...seen.values()].sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 12));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: KIND_COLOR[place.kind] }}>
            {KIND_LABEL[place.kind]}
          </span>
          <span className="badge mono">{place.code}</span>
        </div>
        <h1 className="etitle">{place.name}</h1>
        <div className="actions">
          <button className="btn" onClick={onFly}>
            Fly to
          </button>
        </div>
      </section>
      <section className="isec">
        <dl className="kv">
          <div>
            <dt>{place.kind === 'airport' ? 'IATA code' : 'UN/LOCODE'}</dt>
            <dd className="mono">{place.code}</dd>
          </div>
          {place.country && (
            <div>
              <dt>Country</dt>
              <dd className="mono">{place.country}</dd>
            </div>
          )}
          <div className="wide">
            <dt>Position</dt>
            <dd>
              <CopyCoords lat={place.lat} lon={place.lon} />
            </dd>
          </div>
        </dl>
      </section>
      {place.kind === 'airport' && <FaaSection code={place.code} status={status} />}
      <section className="isec">
        <h3>Headlines{articles ? ' · ' + articles.length : ''}</h3>
        {articles === null ? (
          <p className="quiet small">Searching your news feeds…</p>
        ) : articles.length ? (
          <ul className="news">
            {articles.map((a) => (
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
          <p className="quiet small">No recent headlines in your news feeds name {terms.join(' or ') || 'it'}.</p>
        )}
        <p className="quiet small">
          Searched for {terms.map((t) => '“' + t + '”').join(' and ')} in the headlines Argus keeps from your news
          feeds.
        </p>
      </section>
    </div>
  );
}

function FaaSection({ code, status }: { code: string; status: FaaStatus | null }) {
  const items = status?.airports[code] ?? [];
  const level = faaLevel(items);
  return (
    <section className="isec">
      <h3>
        FAA status
        {level && (
          <span className="badge" style={{ ['--c' as string]: FAA_COLOR[level], marginLeft: 8 }}>
            {level === 'stop' ? 'Stopped' : 'Delays'}
          </span>
        )}
      </h3>
      {status === null ? (
        <p className="quiet small">Checking…</p>
      ) : status.status === 'error' ? (
        <p className="quiet small">The FAA status couldn&apos;t be reached just now.</p>
      ) : items.length ? (
        <ul className="faalist">
          {items.map((i, n) => {
            const { title, detail } = faaLine(i);
            return (
              <li key={n}>
                <b>{title}</b>
                {detail && <span>{detail}</span>}
                {i.reason && <small className="mono">{i.reason}</small>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="quiet small">No ground stops, delays or closures listed for {code}.</p>
      )}
      <p className="quiet small">
        FAA National Airspace System status (US airports only)
        {status?.updated ? ', as of ' + status.updated : ''}
        {status?.status === 'stale' ? '; the latest check failed, so this may be out of date' : ''}.
      </p>
    </section>
  );
}
