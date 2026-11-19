import { useEffect, useRef, useState } from 'react';

import { findAddress, search, type SearchResult } from '../lib/api';

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
  address: 'ADDRESS',
  lookup: 'ADDRESS',
};

// Worth offering an address lookup: some letters and some length.
const looksLikeAddress = (text: string) => text.length >= 5 && /[a-z]/i.test(text);

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
  // Addresses found for the current text (Find address), shown instead
  // of the usual results until the text changes.
  const [addresses, setAddresses] = useState<SearchResult[] | null>(null);
  const [addrNote, setAddrNote] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    setAddresses(null);
    setAddrNote('');
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

  // Ctrl K (Cmd K on a Mac) or "/" focuses the search from anywhere on
  // the map page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const text = q.trim();
  const lookup: SearchResult | null =
    addresses === null && looksLikeAddress(text)
      ? {
          kind: 'lookup',
          label: 'Find address: “' + text + '”',
          detail: 'Street addresses and named places, worldwide',
        }
      : null;
  const items = addresses ?? (lookup ? [...results, lookup] : results);

  async function lookUp() {
    const n = seq.current;
    setBusy(true);
    setAddrNote('');
    try {
      const r = await findAddress(text);
      if (n !== seq.current) return;
      setAddresses(r.results);
      setActive(0);
      setAddrNote(r.results.length ? r.attribution : 'No address found for that. ' + r.attribution);
    } catch (err) {
      if (n === seq.current) setAddrNote(err instanceof Error ? err.message : 'Address search failed.');
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }

  function pick(r: SearchResult) {
    if (r.kind === 'lookup') {
      void lookUp();
      return;
    }
    onPick(r);
    setOpen(false);
    if (r.kind !== 'flight') input.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const r = items[active];
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
      <svg
        className="sicon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="Search anything: flights, callsigns, ships, places…"
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
      <span className="kbd" aria-hidden="true">
        {/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}
      </span>
      {showList && (
        <ul id="search-results" className="sresults" role="listbox">
          {items.map((r, i) => (
            <li key={r.kind + r.label + i} role="option" aria-selected={i === active}>
              <button onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}>
                <span className={'skind k-' + r.kind + (r.mil ? ' mil' : '')}>{KIND_LABEL[r.kind]}</span>
                <span className="sbody">
                  <span className="slabel">{r.label}</span>
                  {r.detail && <small>{r.detail}</small>}
                </span>
              </button>
            </li>
          ))}
          {!items.length && (
            <li className="sempty">
              {busy ? 'Searching…' : addrNote || 'Nothing found. Try a flight (AA100), a place or coordinates.'}
            </li>
          )}
          {items.length > 0 && (busy || addrNote) && <li className="sempty small">{busy ? 'Searching…' : addrNote}</li>}
        </ul>
      )}
    </div>
  );
}
