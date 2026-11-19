import { useEffect, useRef, useState } from 'react';

import { search, type SearchResult } from '../lib/api';

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  coords: 'GO TO',
  aircraft: 'AIRCRAFT',
  flight: 'FLIGHT',
  airport: 'AIRPORT',
  place: 'PLACE',
  event: 'EVENT',
  filter: 'FILTER',
  satellite: 'SATELLITE',
  vessel: 'VESSEL',
};

interface Props {
  onPick: (r: SearchResult) => void;
}

// Universal search: type anything (a flight, hex, registration, airport,
// place, coordinates, event or a word like "tankers"); the server works
// out what it is.
export default function SearchBox({ onPick }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setResults([]);
      return;
    }
    const n = ++seq.current;
    const id = window.setTimeout(() => {
      setBusy(true);
      search(text)
        .then((r) => {
          if (n !== seq.current) return;
          setResults(r.results);
          setActive(0);
        })
        .catch(() => {
          if (n === seq.current) setResults([]);
        })
        .finally(() => {
          if (n === seq.current) setBusy(false);
        });
    }, 250);
    return () => window.clearTimeout(id);
  }, [q]);

  // "/" focuses the search from anywhere on the map page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pick(r: SearchResult) {
    onPick(r);
    setOpen(false);
    if (r.kind !== 'flight') input.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const r = results[active];
      if (r) pick(r);
    } else if (e.key === 'Escape') {
      if (q) setQ('');
      else input.current?.blur();
      setOpen(false);
      e.stopPropagation();
    }
  }

  const showList = open && q.trim().length > 0;
  return (
    <div className="search" role="search">
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="Search flights, aircraft, places, events…  ( / )"
        aria-label="Search"
        aria-expanded={showList}
        aria-controls="search-results"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id="search-results" className="sresults" role="listbox">
          {results.map((r, i) => (
            <li key={r.kind + r.label + i} role="option" aria-selected={i === active}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
              >
                <span className={'skind k-' + r.kind + (r.mil ? ' mil' : '')}>{KIND_LABEL[r.kind]}</span>
                <span className="sbody">
                  <span className="slabel">{r.label}</span>
                  {r.detail && <small>{r.detail}</small>}
                </span>
              </button>
            </li>
          ))}
          {!results.length && (
            <li className="sempty">{busy ? 'Searching…' : 'Nothing found. Try a flight (AA100), a place or coordinates.'}</li>
          )}
        </ul>
      )}
    </div>
  );
}
