import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AircraftInspector from '../components/AircraftInspector';
import AirspaceInspector from '../components/AirspaceInspector';
import AppHeader from '../components/AppHeader';
import { BaseInspector, CableInspector, PlantInspector } from '../components/InfraInspector';
import CockpitHud from '../components/CockpitHud';
import EventInspector from '../components/EventInspector';
import NewsPlayer from '../components/NewsPlayer';
import { DEFAULT_TABS } from '../config/newsChannels';
import SatelliteInspector from '../components/SatelliteInspector';
import VesselInspector from '../components/VesselInspector';
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
  type AirspaceItem,
  type Bbox,
  type CivilStatus,
  type EventItem,
  type EventType,
  getAircraft,
  getEvents,
  getAirspace,
  getAirspaceStructure,
  getGps,
  type GpsCell,
  type Tension,
  getMapConfig,
  getSatelliteCatalog,
  getVessels,
  getSummary,
  getTension,
  type Me,
  savePreferences,
  type SearchResult,
  type SeaStatus,
  type Summary,
  type Vessel,
} from '../lib/api';
import { connectLive, type LiveState } from '../lib/live';
import { CAMERA_MODES, type CameraMode } from '../map/aircraftCamera';
import { DEFAULT_SPACE, type SatCatalog, type SpaceFilters } from '../map/satellites';
import { TINT_FROM } from '../map/tensionLayer';
import type { SeaFilters } from '../map/vesselLayer';
import type { AirspaceFilters } from '../map/airspaceLayer';
import Globe, { type Basemap, BASEMAPS, type GlobeHandle, type Imagery, PHOTO_3D } from '../map/Globe';
import { applyLayers, buildShareLink, takeShareLink } from '../lib/share';

const REFRESH_MS = 60_000;
const CIVIL_MS = 15_000;
const MAX_NEWS_PLAYERS = 4;
const TRAIL_POINTS = 240;
// Camera height when double-clicking an event: close enough to see the
// area, wide enough to keep its surroundings.
const FOCUS_HEIGHT: Record<string, number> = {
  quake: 400_000,
  fire: 120_000,
  conflict: 150_000,
  unrest: 60_000,
  hazard: 600_000,
  maritime: 500_000,
};

function initialFilters(me: Me): LayerFilters {
  const saved = me.preferences.layers as Partial<Record<EventType, boolean>> | undefined;
  const air = me.preferences.air as Partial<AirFilters> | undefined;
  const reference = me.preferences.reference as Partial<LayerFilters['reference']> | undefined;
  return {
    ...DEFAULT_FILTERS,
    types: { ...DEFAULT_FILTERS.types, ...(saved ?? {}) },
    air: { ...DEFAULT_FILTERS.air, ...(air ?? {}) },
    reference: { ...DEFAULT_FILTERS.reference, ...(reference ?? {}) },
    space: { ...DEFAULT_SPACE, ...((me.preferences.space as Partial<SpaceFilters> | undefined) ?? {}) },
    sea: { ...DEFAULT_FILTERS.sea, ...((me.preferences.sea as Partial<SeaFilters> | undefined) ?? {}) },
    infra: { ...DEFAULT_FILTERS.infra, ...((me.preferences.infra as Record<string, boolean> | undefined) ?? {}) },
    airspace: {
      ...DEFAULT_FILTERS.airspace,
      ...((me.preferences.airspace as Partial<AirspaceFilters> | undefined) ?? {}),
    },
    tension: me.preferences.tension !== false,
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
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [seaStatus, setSeaStatus] = useState<SeaStatus>('waiting');
  const [trackedVessel, setTrackedVessel] = useState<Vessel | null>(null);
  // Live news players on the map: one channel each, sharing the tabs.
  const savedNews = (me.preferences.news ?? {}) as {
    open?: boolean;
    channel?: string;
    tabs?: string[];
    players?: string[];
  };
  const [newsPlayers, setNewsPlayers] = useState<string[]>(
    savedNews.players ?? (savedNews.open ? [savedNews.channel ?? DEFAULT_TABS[0]] : []),
  );
  const [newsTabs, setNewsTabs] = useState<string[]>(savedNews.tabs ?? DEFAULT_TABS);
  const saveNews = (players: string[], tabs: string[]) => {
    setNewsPlayers(players);
    setNewsTabs(tabs);
    void savePreferences({
      news: { open: players.length > 0, channel: players[0] ?? savedNews.channel, tabs, players },
    }).catch(() => undefined);
  };
  const [airspaceItems, setAirspaceItems] = useState<AirspaceItem[]>([]);
  const [selectedAirspace, setSelectedAirspace] = useState<string | null>(null);
  const [gpsCells, setGpsCells] = useState<GpsCell[]>([]);
  const [tension, setTension] = useState<Tension | null>(null);
  const [structureItems, setStructureItems] = useState<AirspaceItem[]>([]);
  const [structureStatus, setStructureStatus] = useState<'ok' | 'zoom' | 'nokey' | 'error'>('zoom');
  const [selectedInfra, setSelectedInfra] = useState<string | null>(null);
  const [selectedNorad, setSelectedNorad] = useState<number | null>(null);
  const [followSat, setFollowSat] = useState(false);
  const [satCatalog, setSatCatalog] = useState<SatCatalog | null>(null);
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
  const [historyDepth, setHistoryDepth] = useState(0);
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
  // openAIP airspace for the view (regional views only).
  const loadStructure = useCallback(async () => {
    const bbox = viewRef.current;
    if (!filtersRef.current.airspace.structure || !bbox) return;
    try {
      const r = await getAirspaceStructure(bbox);
      setStructureStatus(r.status);
      if (r.status === 'ok') setStructureItems(r.items);
    } catch {
      setStructureStatus('error');
    }
  }, []);

  // Vessels for the area in view, while any sea layer is on.
  const loadVessels = useCallback(async () => {
    if (!Object.values(filtersRef.current.sea).some(Boolean)) {
      setVessels([]);
      return;
    }
    try {
      const r = await getVessels(viewRef.current);
      setVessels(r.vessels);
      setSeaStatus(r.status);
    } catch {
      // Keep the last picture; the next poll retries.
    }
  }, []);

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
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);
  // Aircraft are only requested while their layer is on.
  useEffect(() => {
    if (!filters.air.military) return;
    void loadMilitary();
    const id = window.setInterval(() => void loadMilitary(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadMilitary, filters.air.military]);
  useEffect(() => {
    void loadCivil();
    if (!filters.air.civil) return;
    const id = window.setInterval(() => void loadCivil(), CIVIL_MS);
    return () => window.clearInterval(id);
  }, [loadCivil, filters.air.civil]);
  const seaOn = Object.values(filters.sea).some(Boolean);
  useEffect(() => {
    void loadVessels();
    if (!seaOn) return;
    const id = window.setInterval(() => void loadVessels(), CIVIL_MS);
    return () => window.clearInterval(id);
  }, [loadVessels, seaOn]);

  // The satellite catalogue (about 17,000 objects) loads only once a
  // space layer is on or a satellite is picked, then hourly.
  const wantSats =
    filters.space.leo || filters.space.meo || filters.space.geo || filters.space.heo || filters.space.starlink || selectedNorad !== null;
  useEffect(() => {
    if (!wantSats) return;
    let cancelled = false;
    async function load() {
      try {
        const body = await getSatelliteCatalog();
        if (cancelled) return;
        setSatCatalog({
          updated: body.updated,
          raw: body.satellites,
          meta: body.satellites.map((r) => ({
            norad: Number(r[0]),
            name: String(r[1]),
            cospar: String(r[2]),
            cls: r[3] as SatCatalog['meta'][number]['cls'],
            tags: (r[4] as string[]) ?? [],
          })),
        });
      } catch {
        // Retried on the next interval.
      }
    }
    if (!satCatalog) void load();
    const id = window.setInterval(() => void load(), 3_600_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // satCatalog is checked once per switch-on; the interval refreshes it.
  }, [wantSats]);
  const satCounts = useMemo(() => {
    const c: Partial<Record<keyof SpaceFilters, number>> = {};
    for (const m of satCatalog?.meta ?? []) {
      const k = m.tags.includes('starlink') ? 'starlink' : m.cls;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [satCatalog]);

  const viewTimer = useRef<number | undefined>(undefined);
  // The area on screen when zoomed in to a region (null for wide views).
  const [viewBox, setViewBox] = useState<Bbox | null>(null);
  // passive: reported while the camera rides along with an aircraft; the
  // regular civil refresh picks the new area up, so don't fetch now.
  const onView = useCallback(
    (bbox: Bbox | null, _height: number, passive = false) => {
      viewRef.current = bbox;
      if (passive) return;
      setViewBox(bbox);
      window.clearTimeout(viewTimer.current);
      viewTimer.current = window.setTimeout(() => {
        void loadCivil();
        void loadVessels();
        void loadStructure();
      }, 400);
    },
    [loadCivil, loadVessels, loadStructure],
  );
  useEffect(() => {
    if (filters.airspace.structure) void loadStructure();
  }, [filters.airspace.structure, loadStructure]);

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
  // Vessels on the map: the chosen categories, and always the selected
  // one (with its freshest position).
  const shownVessels = useMemo(() => {
    const out = vessels.filter((v) => filters.sea[v.category] && v.mmsi !== selectedMmsi);
    const sel =
      trackedVessel?.mmsi === selectedMmsi ? trackedVessel : vessels.find((v) => v.mmsi === selectedMmsi);
    if (sel) out.push(sel);
    return out;
  }, [vessels, filters.sea, selectedMmsi, trackedVessel]);
  const seaCounts = useMemo(() => {
    const c: Partial<Record<keyof SeaFilters, number>> = {};
    for (const v of vessels) c[v.category] = (c[v.category] ?? 0) + 1;
    return c;
  }, [vessels]);
  // The camera views follow an aircraft, or a vessel in the same shape.
  const trackTarget = useMemo((): Aircraft | null => {
    if (selectedHex) return aircraft.find((a) => a.hex === selectedHex) ?? null;
    const v = selectedMmsi !== null ? shownVessels.find((x) => x.mmsi === selectedMmsi) : undefined;
    if (!v) return null;
    return {
      hex: 'ship' + v.mmsi,
      callsign: v.name ?? '',
      reg: '',
      type: '',
      mil: false,
      role: null,
      lat: v.lat,
      lon: v.lon,
      alt_ft: 0,
      ground: false,
      gs_kt: v.sog,
      track: v.cog ?? v.heading,
      vrate: 0,
      squawk: null,
      emergency: false,
      seen: v.age_s,
    };
  }, [aircraft, selectedHex, selectedMmsi, shownVessels]);

  // Tension index: the Situation panel shows it, the map tints with it.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getTension()
        .then((t) => !cancelled && setTension(t))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 300_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Airspace areas, while any airspace layer is on (every 10 minutes).
  const airspaceOn = filters.airspace.tfr || filters.airspace.sigmet || filters.airspace.czib;
  useEffect(() => {
    if (!filters.airspace.gps) return;
    let cancelled = false;
    const load = () =>
      getGps()
        .then((r) => !cancelled && setGpsCells(r.cells))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 300_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [filters.airspace.gps]);
  useEffect(() => {
    if (!airspaceOn) return;
    let cancelled = false;
    const load = () =>
      getAirspace()
        .then((r) => !cancelled && setAirspaceItems(r.items))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 600_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [airspaceOn]);
  const airspaceCounts = useMemo(() => {
    const c: Partial<Record<keyof AirspaceFilters, number>> = {};
    for (const i of airspaceItems) c[i.kind] = (c[i.kind] ?? 0) + 1;
    c.gps = gpsCells.filter((x) => x.level !== 'low').length;
    if (structureStatus === 'ok') c.structure = structureItems.length;
    return c;
  }, [airspaceItems, gpsCells, structureItems, structureStatus]);
  const allAirspace = useMemo(() => [...airspaceItems, ...structureItems], [airspaceItems, structureItems]);
  const selectedAirspaceItem = allAirspace.find((i) => i.key === selectedAirspace) ?? null;
  const selectedPlant =
    selectedInfra?.startsWith('pp:') ? (globe.current?.plant(Number(selectedInfra.slice(3))) ?? null) : null;
  const selectedCable = selectedInfra?.startsWith('cable:') ? (globe.current?.cable(selectedInfra.slice(6)) ?? null) : null;
  const selectedBase =
    selectedInfra?.startsWith('mil:') ? (globe.current?.base(Number(selectedInfra.slice(4))) ?? null) : null;

  const airCounts = useMemo(
    () => ({ military: military.length, civil: civil.length }),
    [military, civil],
  );

  function changeFilters(next: LayerFilters) {
    setFilters(next);
    void savePreferences({
      layers: next.types,
      air: next.air,
      reference: next.reference,
      space: next.space,
      sea: next.sea,
      airspace: next.airspace,
      infra: next.infra,
      tension: next.tension,
    }).catch(
      () => undefined,
    );
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
    setSelectedNorad(null);
    setSelectedMmsi(null);
    setTrackedVessel(null);
    setSelectedAirspace(null);
    setSelectedInfra(null);
    setFollowSat(false);
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
      else if (e.key === 'b' || e.key === 'B') {
        setCamera('free');
        globe.current?.back();
      } else if (e.key === 't' || e.key === 'T') camPreset('top');
      else if (e.key === 'o' || e.key === 'O') camPreset('oblique');
      else if (e.key === 'n' || e.key === 'N') camPreset('north');
      else if ((e.key === 'v' || e.key === 'V') && (selectedHex || selectedMmsi)) {
        const i = CAMERA_MODES.findIndex((m) => m.id === camera);
        setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length].id);
      } else if (e.key === 'Escape') {
        if (camera !== 'free') setCamera('free');
        else clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePanel, clearSelection, camera, selectedHex, selectedMmsi]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  function camPreset(kind: 'top' | 'oblique' | 'north') {
    setCamera('free');
    if (kind === 'top') globe.current?.topDown();
    else if (kind === 'oblique') globe.current?.oblique();
    else globe.current?.northUp();
  }

  async function copyLink() {
    const url = buildShareLink({
      camera: globe.current?.cameraString() ?? null,
      basemap,
      filters,
      eventId: selected,
      hex: selectedHex,
      norad: selectedNorad,
      mmsi: selectedMmsi,
      view: camera,
    });
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied. It opens this view, layers and selection.');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  // A share link opens here: apply its base map, layers, selection and
  // camera once, without changing the user's saved preferences.
  function applyShare() {
    const share = takeShareLink();
    if (!share) return;
    if (share.basemap) setBasemap(share.basemap);
    if (share.layers) setFilters((f) => applyLayers(f, share.layers as string[]));
    if (share.mmsi) selectVessel(share.mmsi, share.view ?? 'follow');
    else if (share.norad) selectSatellite(share.norad, true);
    else if (share.hex) selectAircraft(share.hex, share.view ?? 'free');
    else if (share.eventId) select(share.eventId);
    if (share.camera && !(share.hex && share.view && share.view !== 'free')) {
      globe.current?.applyCamera(share.camera);
    }
  }
  // On first render, and when a link is opened in a tab already on the map.
  const applyShareRef = useRef(applyShare);
  applyShareRef.current = applyShare;
  useEffect(() => {
    applyShareRef.current();
    const onHash = () => applyShareRef.current();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function openRight() {
    if (!rightOpen) setRightOpen(true);
  }

  // Map clicks: event ids, "ac:<hex>" for aircraft, "sat:<norad>".
  function select(id: string | null) {
    if (id && id.startsWith('ac:')) {
      selectAircraft(id.slice(3));
      return;
    }
    if (id && id.startsWith('sat:')) {
      selectSatellite(Number(id.slice(4)));
      return;
    }
    if (id && id.startsWith('ship:')) {
      selectVessel(Number(id.slice(5)));
      return;
    }
    if (id && (id.startsWith('pp:') || id.startsWith('cable:') || id.startsWith('mil:'))) {
      clearSelection();
      setSelectedInfra(id);
      openRight();
      return;
    }
    if (id && id.startsWith('air:')) {
      clearSelection();
      setSelectedAirspace(id.slice(4));
      openRight();
      return;
    }
    clearSelection();
    setSelected(id);
    if (id) openRight();
  }

  function selectVessel(mmsi: number, view: CameraMode = 'free') {
    clearSelection();
    setSelectedMmsi(mmsi);
    setCamera(view);
    openRight();
  }

  function selectSatellite(norad: number, follow = false) {
    clearSelection();
    setSelectedNorad(norad);
    setFollowSat(follow);
    openRight();
  }

  function selectAircraft(hex: string, view: CameraMode = 'free') {
    setSelected(null);
    setSelectedNorad(null);
    setSelectedMmsi(null);
    setTrackedVessel(null);
    setFollowSat(false);
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
    if (r.kind === 'vessel' && r.mmsi) {
      const v = vessels.find((x) => x.mmsi === r.mmsi);
      const cat = v?.category;
      if (cat && !filters.sea[cat]) changeFilters({ ...filters, sea: { ...filters.sea, [cat]: true } });
      selectVessel(r.mmsi, 'follow');
      return;
    }
    if (r.kind === 'satellite' && r.norad) {
      selectSatellite(r.norad, true);
      return;
    }
    if (r.kind === 'filter' && r.filter) {
      if (r.filter.events) {
        const types = { conflict: false, unrest: false, quake: false, fire: false, hazard: false, maritime: false };
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
            tensionCount={tension ? tension.countries.filter((c) => c.level >= TINT_FROM).length : undefined}
            airCounts={airCounts}
            civilStatus={civilStatus}
            satCounts={satCounts}
            seaCounts={seaCounts}
            seaStatus={seaStatus}
            airspaceCounts={airspaceCounts}
            structureStatus={structureStatus}
            onChange={changeFilters}
          />
        )}
        <section className="mapcell">
          <Globe
            ref={globe}
            basemap={basemap}
            imagery={imagery}
            reference={filters.reference}
            satellites={satCatalog}
            space={filters.space}
            selectedNorad={selectedNorad}
            followSat={followSat}
            vessels={shownVessels}
            selectedMmsi={selectedMmsi}
            trackTarget={trackTarget}
            airspace={allAirspace}
            airspaceFilters={filters.airspace}
            selectedAirspace={selectedAirspace}
            gpsCells={gpsCells}
            tensionCountries={tension?.countries ?? []}
            showTension={filters.tension}
            infra={filters.infra}
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
            onHistory={setHistoryDepth}
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
            <button
              className="iconbtn"
              title="Back to the previous view ( B )"
              aria-label="Back"
              disabled={historyDepth === 0}
              onClick={() => {
                setCamera('free');
                globe.current?.back();
              }}
            >
              ↶
            </button>
            <span className="mc-gap" />
            <button className="iconbtn small" title="Look straight down ( T )" aria-label="Top-down view" onClick={() => camPreset('top')}>
              TOP
            </button>
            <button className="iconbtn small" title="Tilt to 35° ( O )" aria-label="Oblique view" onClick={() => camPreset('oblique')}>
              35°
            </button>
            <button className="iconbtn small" title="North up ( N )" aria-label="North up" onClick={() => camPreset('north')}>
              N↑
            </button>
            <span className="mc-gap" />
            <button
              className={'iconbtn small' + (newsPlayers.length ? ' on' : '')}
              title="Live news channels"
              aria-label="Live news"
              aria-pressed={newsPlayers.length > 0}
              onClick={() => saveNews(newsPlayers.length ? [] : [savedNews.channel ?? newsTabs[0] ?? DEFAULT_TABS[0]], newsTabs)}
            >
              TV
            </button>
            <button className="iconbtn" title="Copy a link to this view" aria-label="Copy link" onClick={() => void copyLink()}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
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
          {newsPlayers.map((channel, i) => (
            <NewsPlayer
              key={i}
              index={i}
              channel={channel}
              tabs={newsTabs}
              onChannel={(id) => saveNews(newsPlayers.map((c, j) => (j === i ? id : c)), newsTabs)}
              onTabs={(ids) => saveNews(newsPlayers, ids)}
              onClose={() => saveNews(newsPlayers.filter((_, j) => j !== i), newsTabs)}
              onAdd={
                newsPlayers.length < MAX_NEWS_PLAYERS
                  ? () => {
                      // Start the new player on the next tab not already playing.
                      const next = newsTabs.find((t) => !newsPlayers.includes(t)) ?? channel;
                      saveNews([...newsPlayers, next], newsTabs);
                    }
                  : undefined
              }
            />
          ))}
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
            {selectedBase ? (
              <BaseInspector
                base={selectedBase}
                onBack={clearSelection}
                onFly={() => globe.current?.flyTo(selectedBase[3], selectedBase[2], 30_000)}
              />
            ) : selectedPlant ? (
              <PlantInspector
                plant={selectedPlant}
                onBack={clearSelection}
                onFly={() => globe.current?.flyTo(selectedPlant[5], selectedPlant[4], 25_000)}
              />
            ) : selectedCable ? (
              <CableInspector cable={selectedCable} onBack={clearSelection} />
            ) : selectedAirspaceItem ? (
              <AirspaceInspector
                item={selectedAirspaceItem}
                onBack={clearSelection}
                onFly={() => {
                  const it = selectedAirspaceItem;
                  if (it.lat !== null && it.lon !== null) globe.current?.flyTo(it.lat, it.lon, 900_000);
                }}
              />
            ) : selectedMmsi !== null ? (
              <VesselInspector
                mmsi={selectedMmsi}
                camera={camera}
                onBack={clearSelection}
                onCamera={setCamera}
                onFly={(lat, lon) => {
                  setCamera('free');
                  globe.current?.flyTo(lat, lon, 40_000);
                }}
                onUpdate={setTrackedVessel}
              />
            ) : selectedNorad !== null ? (
              <SatelliteInspector
                norad={selectedNorad}
                home={home}
                following={followSat}
                onBack={clearSelection}
                onFollow={setFollowSat}
                onFly={() => {
                  setFollowSat(false);
                  globe.current?.flyToSatellite(selectedNorad);
                }}
                orbit={(n) => globe.current?.satOrbit(n) ?? Promise.resolve(null)}
                passes={(n, lat, lon) => globe.current?.satPasses(n, lat, lon) ?? Promise.resolve([])}
              />
            ) : selectedHex ? (
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
              <SituationPanel
                summary={summary}
                events={shown}
                home={home}
                onSelect={selectAndFly}
                aircraft={aircraft}
                onSelectAircraft={(hex) => selectAircraft(hex, 'follow')}
                tension={tension}
                view={viewBox}
              />
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
