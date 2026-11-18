import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AppHeader from '../components/AppHeader';
import EventInspector from '../components/EventInspector';
import LayerPanel, { DEFAULT_FILTERS, type LayerFilters } from '../components/LayerPanel';
import SituationPanel from '../components/SituationPanel';
import {
  type EventItem,
  type EventType,
  getEvents,
  getSummary,
  type Me,
  savePreferences,
  type Summary,
} from '../lib/api';
import { connectLive, type LiveState } from '../lib/live';
import Globe, { type Basemap, BASEMAPS, type GlobeHandle } from '../map/Globe';

const REFRESH_MS = 60_000;

function initialFilters(me: Me): LayerFilters {
  const saved = me.preferences.layers as Partial<Record<EventType, boolean>> | undefined;
  return saved ? { ...DEFAULT_FILTERS, types: { ...DEFAULT_FILTERS.types, ...saved } } : DEFAULT_FILTERS;
}

export default function MapPage({ me, onSignedOut }: { me: Me; onSignedOut: () => Promise<void> }) {
  const globe = useRef<GlobeHandle>(null);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const [basemap, setBasemap] = useState<Basemap>(() =>
    BASEMAPS.some((b) => b.id === me.preferences.basemap)
      ? (me.preferences.basemap as Basemap)
      : 'dark',
  );
  const [leftOpen, setLeftOpen] = useState(me.preferences.left_open !== false);
  const [rightOpen, setRightOpen] = useState(me.preferences.right_open !== false);
  const [filters, setFilters] = useState<LayerFilters>(() => initialFilters(me));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>('connecting');
  const [loadError, setLoadError] = useState('');
  const home = me.preferences.home ?? null;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async () => {
    const f = filtersRef.current;
    try {
      const [ev, sum] = await Promise.all([
        getEvents({ hours: f.hours, candidates: f.candidates, minSeverity: f.minSeverity }),
        getSummary(),
      ]);
      setEvents(ev.events);
      setSummary(sum);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load events.');
    }
  }, []);

  // Reload when server-side filters change, and on a slow timer as a
  // fallback for missed live messages.
  useEffect(() => {
    void load();
  }, [load, filters.hours, filters.candidates, filters.minSeverity]);
  useEffect(() => {
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Live updates: merge changed events into the list.
  useEffect(
    () =>
      connectLive((changed) => {
        const f = filtersRef.current;
        setEvents((current) => {
          const byId = new Map(current.map((e) => [e.id, e]));
          for (const e of changed) {
            const visible =
              e.severity >= f.minSeverity &&
              (e.status === 'active' || (f.candidates && e.status === 'candidate'));
            if (visible) byId.set(e.id, e);
            else byId.delete(e.id);
          }
          return [...byId.values()];
        });
      }, setLive),
    [],
  );

  const shown = useMemo(() => events.filter((e) => filters.types[e.type]), [events, filters.types]);
  const counts = useMemo(() => {
    const c: Partial<Record<EventType, number>> = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [events]);

  function changeFilters(next: LayerFilters) {
    setFilters(next);
    void savePreferences({ layers: next.types }).catch(() => undefined);
  }

  const togglePanel = useCallback(
    (side: 'L' | 'R') => {
      if (side === 'L') {
        const v = !leftOpen;
        setLeftOpen(v);
        void savePreferences({ left_open: v }).catch(() => undefined);
      } else {
        const v = !rightOpen;
        setRightOpen(v);
        void savePreferences({ right_open: v }).catch(() => undefined);
      }
    },
    [leftOpen, rightOpen],
  );

  // [ and ] toggle the panels, Esc clears the selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '[') togglePanel('L');
      else if (e.key === ']') togglePanel('R');
      else if (e.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePanel]);

  function select(id: string | null) {
    setSelected(id);
    if (id && !rightOpen) setRightOpen(true);
  }

  function selectAndFly(id: string) {
    select(id);
    const e = events.find((x) => x.id === id);
    if (e) globe.current?.flyTo(e.lat, e.lon);
  }

  return (
    <div className="app">
      <AppHeader me={me} onSignedOut={onSignedOut} live={live} />
      <main className={'ws' + (leftOpen ? '' : ' noL') + (rightOpen ? '' : ' noR')}>
        {leftOpen && <LayerPanel filters={filters} counts={counts} onChange={changeFilters} />}
        <section className="mapcell">
          <Globe
            ref={globe}
            basemap={basemap}
            home={home}
            events={shown}
            selectedId={selected}
            onSelect={select}
          />
          <div className="mc tl">
            <div className="seg" role="group" aria-label="Projection">
              {(['3d', '2d'] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    globe.current?.setMode(m);
                  }}
                >
                  {m === '3d' ? '3D Globe' : '2D World'}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Base map">
              {BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  aria-pressed={basemap === b.id}
                  onClick={() => {
                    setBasemap(b.id);
                    void savePreferences({ basemap: b.id }).catch(() => undefined);
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mc tr">
            <button
              className="iconbtn"
              title={home ? 'Fly home' : 'Reset view'}
              aria-label="Fly home"
              onClick={() => globe.current?.flyHome()}
            >
              ⌂
            </button>
            <button
              className="iconbtn"
              title="World view"
              aria-label="World view"
              onClick={() => globe.current?.flyWorld()}
            >
              ◎
            </button>
          </div>
          <button
            className="edge l"
            aria-label="Toggle layer panel"
            title="Layers ( [ )"
            onClick={() => togglePanel('L')}
          >
            {leftOpen ? '‹' : '›'}
          </button>
          <button
            className="edge r"
            aria-label="Toggle situation panel"
            title="Situation ( ] )"
            onClick={() => togglePanel('R')}
          >
            {rightOpen ? '›' : '‹'}
          </button>
          {loadError && <div className="notice">{loadError}</div>}
        </section>
        {rightOpen && (
          <aside className="side right" aria-label="Inspector">
            {selected ? (
              <EventInspector
                id={selected}
                onBack={() => setSelected(null)}
                onFly={(lat, lon) => globe.current?.flyTo(lat, lon)}
              />
            ) : (
              <SituationPanel summary={summary} events={shown} home={home} onSelect={selectAndFly} />
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
