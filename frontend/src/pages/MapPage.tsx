import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AircraftInspector from '../components/AircraftInspector';
import AppHeader from '../components/AppHeader';
import CockpitHud from '../components/CockpitHud';
import EventInspector from '../components/EventInspector';
import LayerPanel, {
  type AirFilters,
  DEFAULT_FILTERS,
  type LayerFilters,
} from '../components/LayerPanel';
import SearchBox from '../components/SearchBox';
import SituationPanel from '../components/SituationPanel';
import {
  type Aircraft,
  type AircraftDetail,
  type Bbox,
  type CivilStatus,
  type EventItem,
  type EventType,
  getAircraft,
  getEvents,
  getMapConfig,
  getSummary,
  type Me,
  savePreferences,
  type SearchResult,
  type Summary,
} from '../lib/api';
import { connectLive, type LiveState } from '../lib/live';
import { CAMERA_MODES, type CameraMode } from '../map/aircraftCamera';
import Globe, { type Basemap, BASEMAPS, type GlobeHandle, type Imagery, PHOTO_3D } from '../map/Globe';

const REFRESH_MS = 60_000;
const CIVIL_MS = 15_000;
const TRAIL_POINTS = 240;
// Camera height when double-clicking an event: close enough to see the
// area, wide enough to keep its surroundings.
const FOCUS_HEIGHT: Record<string, number> = {
  quake: 400_000,
  fire: 120_000,
  conflict: 150_000,
  unrest: 60_000,
};

function initialFilters(me: Me): LayerFilters {
  const saved = me.preferences.layers as Partial<Record<EventType, boolean>> | undefined;
  const air = me.preferences.air as Partial<AirFilters> | undefined;
  return {
    ...DEFAULT_FILTERS,
    types: { ...DEFAULT_FILTERS.types, ...(saved ?? {}) },
    air: { ...DEFAULT_FILTERS.air, ...(air ?? {}) },
  };
}

function matchesFocus(a: Aircraft, focus: string): boolean {
  if (!focus) return true;
  if (focus === 'emergency') return a.emergency;
  return a.mil && a.role === focus;
}

export default function MapPage({ me, onSignedOut }: { me: Me; onSignedOut: () => Promise<void> }) {
  const globe = useRef<GlobeHandle>(null);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const [basemap, setBasemap] = useState<Basemap>(() =>
    [...BASEMAPS, PHOTO_3D].some((b) => b.id === me.preferences.basemap)
      ? (me.preferences.basemap as Basemap)
      : 'dark',
  );
  const [imagery, setImagery] = useState<Imagery | null>(null);
  useEffect(() => {
    getMapConfig()
      .then((c) => setImagery(c.imagery))
      .catch(() => setImagery(null));
  }, []);
  const basemaps = imagery?.google_3d ? [...BASEMAPS, PHOTO_3D] : BASEMAPS;
  // 3D was saved but an admin has since turned it off.
  useEffect(() => {
    if (imagery && basemap === 'photo3d' && !imagery.google_3d) setBasemap('satellite');
  }, [imagery, basemap]);
  const [leftOpen, setLeftOpen] = useState(me.preferences.left_open !== false);
  const [rightOpen, setRightOpen] = useState(me.preferences.right_open !== false);
  const [filters, setFilters] = useState<LayerFilters>(() => initialFilters(me));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraMode>('free');
  const [military, setMilitary] = useState<Aircraft[]>([]);
  const [civil, setCivil] = useState<Aircraft[]>([]);
  const [civilStatus, setCivilStatus] = useState<CivilStatus>('zoom');
  const [tracked, setTracked] = useState<Aircraft | null>(null);
  const [trackedAt, setTrackedAt] = useState(0);
  const trackedRef = useRef<Aircraft | null>(null);
  const [trackedRoute, setTrackedRoute] = useState<AircraftDetail['route']>(null);
  const [trail, setTrail] = useState<number[][] | null>(null);
  const [live, setLive] = useState<LiveState>('connecting');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const home = me.preferences.home ?? null;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const viewRef = useRef<Bbox | null>(null);

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

  // Military aircraft: the live socket pushes snapshots; this is the
  // first load and the fallback when the socket is quiet.
  const loadMilitary = useCallback(async () => {
    try {
      const r = await getAircraft(null, false);
      setMilitary(r.aircraft.filter((a) => a.mil));
    } catch {
      // The next live snapshot or refresh fills it in.
    }
  }, []);

  // Civil aircraft for the area in view, when the view is regional.
  const loadCivil = useCallback(async () => {
    if (!filtersRef.current.air.civil) {
      setCivil([]);
      return;
    }
    const bbox = viewRef.current;
    if (!bbox) {
      setCivil([]);
      setCivilStatus('zoom');
      return;
    }
    try {
      const r = await getAircraft(bbox, true);
      setCivilStatus(r.civil_status);
      setCivil(r.civil_status === 'ok' ? r.aircraft.filter((a) => !a.mil) : []);
    } catch {
      setCivilStatus('error');
    }
  }, []);

  // Reload when server-side filters change, and on a slow timer as a
  // fallback for missed live messages.
  useEffect(() => {
    void load();
  }, [load, filters.hours, filters.candidates, filters.minSeverity]);
  useEffect(() => {
    void loadMilitary();
    const id = window.setInterval(() => {
      void load();
      void loadMilitary();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, loadMilitary]);
  useEffect(() => {
    void loadCivil();
    const id = window.setInterval(() => void loadCivil(), CIVIL_MS);
    return () => window.clearInterval(id);
  }, [loadCivil, filters.air.civil]);

  const viewTimer = useRef<number | undefined>(undefined);
  // passive: reported while the camera rides along with an aircraft; the
  // regular civil refresh picks the new area up, so don't fetch now.
  const onView = useCallback(
    (bbox: Bbox | null, _height: number, passive = false) => {
      viewRef.current = bbox;
      if (passive) return;
      window.clearTimeout(viewTimer.current);
      viewTimer.current = window.setTimeout(() => void loadCivil(), 400);
    },
    [loadCivil],
  );

  // Live updates: merge changed events, replace the military picture.
  useEffect(
    () =>
      connectLive(
        (changed) => {
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
        },
        setLive,
        (snapshot) => setMilitary(snapshot),
      ),
    [],
  );

  const shown = useMemo(() => events.filter((e) => filters.types[e.type]), [events, filters.types]);
  const counts = useMemo(() => {
    const c: Partial<Record<EventType, number>> = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [events]);

  // Aircraft on the map: the chosen layers and focus, and always the one
  // being tracked (with its freshest position).
  const aircraft = useMemo(() => {
    const air = filters.air;
    const byHex = new Map<string, Aircraft>();
    if (air.civil) for (const a of civil) if (matchesFocus(a, air.focus)) byHex.set(a.hex, a);
    if (air.military) for (const a of military) if (matchesFocus(a, air.focus)) byHex.set(a.hex, a);
    if (selectedHex) {
      // The inspector polls the selected aircraft every 10 s, so its copy
      // is usually the freshest.
      const latest =
        (tracked?.hex === selectedHex ? tracked : undefined) ??
        military.find((a) => a.hex === selectedHex) ??
        civil.find((a) => a.hex === selectedHex);
      if (latest) byHex.set(latest.hex, latest);
    }
    return [...byHex.values()];
  }, [military, civil, filters.air, selectedHex, tracked]);
  const airCounts = useMemo(
    () => ({ military: military.length, civil: civil.length }),
    [military, civil],
  );

  function changeFilters(next: LayerFilters) {
    setFilters(next);
    void savePreferences({ layers: next.types, air: next.air }).catch(() => undefined);
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

  const clearSelection = useCallback(() => {
    setSelected(null);
    setSelectedHex(null);
    setCamera('free');
    setTracked(null);
    trackedRef.current = null;
    setTrackedRoute(null);
    setTrail(null);
  }, []);

  // [ and ] toggle the panels, V cycles the aircraft views, Esc leaves the
  // view first and then clears the selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[') togglePanel('L');
      else if (e.key === ']') togglePanel('R');
      else if ((e.key === 'v' || e.key === 'V') && selectedHex) {
        const i = CAMERA_MODES.findIndex((m) => m.id === camera);
        setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length].id);
      } else if (e.key === 'Escape') {
        if (camera !== 'free') setCamera('free');
        else clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePanel, clearSelection, camera, selectedHex]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  function openRight() {
    if (!rightOpen) setRightOpen(true);
  }

  // Map clicks: event ids, or "ac:<hex>" for aircraft.
  function select(id: string | null) {
    if (id && id.startsWith('ac:')) {
      selectAircraft(id.slice(3));
      return;
    }
    clearSelection();
    setSelected(id);
    if (id) openRight();
  }

  function selectAircraft(hex: string, view: CameraMode = 'free') {
    setSelected(null);
    if (hex !== selectedHex) {
      setTrail(null);
      setTracked(null);
    }
    setSelectedHex(hex);
    setCamera(view);
    openRight();
  }

  // Double-click: an event zooms in on its area, an aircraft is followed.
  function focus(id: string) {
    if (id.startsWith('ac:')) {
      selectAircraft(id.slice(3), 'follow');
      return;
    }
    const e = events.find((x) => x.id === id);
    if (!e) return;
    select(id);
    globe.current?.flyTo(e.lat, e.lon, FOCUS_HEIGHT[e.type] ?? 250_000);
  }

  function selectAndFly(id: string) {
    select(id);
    const e = events.find((x) => x.id === id);
    if (e) globe.current?.flyTo(e.lat, e.lon);
  }

  // Inspector polls: keep the tracked aircraft's position and grow its
  // trail (the server keeps trails for military aircraft only).
  const onAircraftUpdate = useCallback((a: Aircraft, serverTrail: number[][], d: AircraftDetail) => {
    const prev = trackedRef.current;
    if (!prev || prev.hex !== a.hex || prev.lat !== a.lat || prev.lon !== a.lon) {
      setTrackedAt(performance.now() - Math.max(0, a.seen ?? 0) * 1000);
    }
    trackedRef.current = a;
    setTracked(a);
    // Only a route that matches the aircraft's position is worth showing.
    setTrackedRoute(d.progress?.plausible === false ? null : d.route);
    setTrail((current) => {
      if (serverTrail.length >= 2) return serverTrail;
      const points = current ?? [];
      const last = points[points.length - 1];
      if (last && last[0] === a.lon && last[1] === a.lat) return points;
      return [...points, [a.lon, a.lat, a.alt_ft ?? 0, Date.now() / 1000]].slice(-TRAIL_POINTS);
    });
  }, []);

  function applyAirFilter(mode: string) {
    const air: AirFilters =
      mode === 'military'
        ? { military: true, civil: false, focus: '' }
        : mode === 'all'
          ? { military: true, civil: true, focus: '' }
          : mode === 'emergency'
            ? { military: true, civil: true, focus: 'emergency' }
            : { military: true, civil: false, focus: mode };
    changeFilters({ ...filters, air });
  }

  function onSearch(r: SearchResult) {
    if (r.kind === 'filter' && r.filter) {
      if (r.filter.events) {
        const types = { conflict: false, unrest: false, quake: false, fire: false };
        for (const t of r.filter.events) types[t] = true;
        changeFilters({ ...filters, types });
      }
      if (r.filter.aircraft) applyAirFilter(r.filter.aircraft);
      return;
    }
    if (r.kind === 'flight') {
      setNotice(r.label + ' is not airborne or not being seen right now.');
      return;
    }
    if (r.kind === 'aircraft' && r.hex) {
      // Make sure the layer it belongs to is on.
      const air = filters.air;
      if ((r.mil && !air.military) || (!r.mil && !air.civil) || air.focus) {
        changeFilters({
          ...filters,
          air: { ...air, focus: '', military: air.military || Boolean(r.mil), civil: air.civil || !r.mil },
        });
      }
      selectAircraft(r.hex, 'follow');
    } else if (r.kind === 'event' && r.id) {
      clearSelection();
      setSelected(r.id);
      openRight();
    }
    if (r.kind !== 'aircraft' && r.lat !== undefined && r.lon !== undefined) {
      globe.current?.flyTo(r.lat, r.lon, r.height_m);
    }
  }

  return (
    <div className="app">
      <AppHeader me={me} onSignedOut={onSignedOut} live={live} />
      <main className={'ws' + (leftOpen ? '' : ' noL') + (rightOpen ? '' : ' noR')}>
        {leftOpen && (
          <LayerPanel
            filters={filters}
            counts={counts}
            airCounts={airCounts}
            civilStatus={civilStatus}
            onChange={changeFilters}
          />
        )}
        <section className="mapcell">
          <Globe
            ref={globe}
            basemap={basemap}
            imagery={imagery}
            home={home}
            events={shown}
            selectedId={selected}
            onSelect={select}
            onFocus={focus}
            aircraft={aircraft}
            selectedHex={selectedHex}
            trail={trail}
            camera={camera}
            onView={onView}
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
              {basemaps.map((b) => (
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
          <div className="mc tc">
            <SearchBox onPick={onSearch} />
          </div>
          <div className="mc tr">
            <button
              className="iconbtn"
              title={home ? 'Fly home' : 'Reset view'}
              aria-label="Fly home"
              onClick={() => {
                setCamera('free');
                globe.current?.flyHome();
              }}
            >
              ⌂
            </button>
            <button
              className="iconbtn"
              title="World view"
              aria-label="World view"
              onClick={() => {
                setCamera('free');
                globe.current?.flyWorld();
              }}
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
          {(loadError || notice) && <div className="notice">{loadError || notice}</div>}
          {camera === 'cockpit' && tracked && (
            <CockpitHud aircraft={tracked} reportedAt={trackedAt} destination={trackedRoute?.destination ?? null} />
          )}
          {camera !== 'free' && camera !== 'cockpit' && tracked && (
            <div className="camhud" role="status">
              <b>{CAMERA_MODES.find((m) => m.id === camera)?.label}</b>
              <span className="mono">{tracked.callsign || tracked.reg || tracked.hex.toUpperCase()}</span>
              {tracked.alt_ft !== null && (
                <span className="mono">{tracked.ground ? 'GND' : tracked.alt_ft.toLocaleString() + ' ft'}</span>
              )}
              {tracked.gs_kt !== null && <span className="mono">{Math.round(tracked.gs_kt)} kt</span>}
              <small>V next view · Esc exit</small>
            </div>
          )}
        </section>
        {rightOpen && (
          <aside className="side right" aria-label="Inspector">
            {selectedHex ? (
              <AircraftInspector
                hex={selectedHex}
                camera={camera}
                onBack={clearSelection}
                onCamera={setCamera}
                onFly={(lat, lon) => {
                  setCamera('free');
                  globe.current?.flyTo(lat, lon, 150_000);
                }}
                onUpdate={onAircraftUpdate}
              />
            ) : selected ? (
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
