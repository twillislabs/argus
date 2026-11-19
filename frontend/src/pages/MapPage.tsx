import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AircraftInspector from '../components/AircraftInspector';
import AirspaceInspector from '../components/AirspaceInspector';
import AppHeader from '../components/AppHeader';
import { BaseInspector, CableInspector, PlantInspector } from '../components/InfraInspector';
import PlaceInspector from '../components/PlaceInspector';
import ImageryPanel, { type ImageryState, newImagery } from '../components/ImageryPanel';
import TourPanel from '../components/TourPanel';
import { cleanTour, type Tour } from '../lib/tours';
import { FAA_COLOR, faaLevel, faaLine, type FaaStatus, getFaaStatus } from '../lib/faa';
import AlprInspector from '../components/AlprInspector';
import BridgeHud from '../components/BridgeHud';
import CamInspector from '../components/CamInspector';
import WebcamInspector from '../components/WebcamInspector';
import CockpitHud from '../components/CockpitHud';
import EventInspector from '../components/EventInspector';
import { CursorReadout, LIVE, type Replay, ScaleBar, Timeline } from '../components/MapFooter';
import { type HoverInfo, HoverLayer } from '../components/HoverCard';
import InfoInspector from '../components/InfoInspector';
import Legend from '../components/Legend';
import MapContextMenu from '../components/MapContextMenu';
import MapToolbar from '../components/MapToolbar';
import SelectionPanel, { type AreaSelection } from '../components/SelectionPanel';
import { inRing } from '../lib/geo';
import { type DrawCallbacks, type Drawing, describeShape, type Tool } from '../map/drawTools';
import NewsPlayer from '../components/NewsPlayer';
import { DEFAULT_TABS } from '../config/newsChannels';
import SatelliteInspector from '../components/SatelliteInspector';
import VesselInspector from '../components/VesselInspector';
import LayerPanel, {
  type AirFilters,
  serverFilters,
  type LayerFilters,
} from '../components/LayerPanel';
import SearchBox from '../components/SearchBox';
import SituationPanel, { BAND_LABEL } from '../components/SituationPanel';
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
  getAlpr,
  getCams,
  type TrafficCam,
  getWebcams,
  type Webcam,
  type AlprCamera,
  type AlprStatus,
  getGps,
  type GpsCell,
  getOutlook,
  getWeatherNow,
  getWxAlerts,
  type OutlookArea,
  type WeatherNow,
  type WxAlert,
  type Tension,
  getMapConfig,
  getSatelliteCatalog,
  getVessels,
  getSummary,
  getTension,
  getAdvisories,
  type Advisory,
  getWikipedia,
  type WikiItem,
  type Me,
  savePreferences,
  type SearchResult,
  type SeaStatus,
  type Summary,
  type Vessel,
} from '../lib/api';
import { connectLive, type LiveState } from '../lib/live';
import { CAMERA_MODES, type CameraMode } from '../map/aircraftCamera';
import type { SatCatalog, SpaceFilters } from '../map/satellites';
import { TINT_FROM } from '../map/tensionLayer';
import { ADVISORY_COLOR } from '../map/advisoryLayer';
import { WIKI_COLOR, WIKI_CONFLICT_COLOR } from '../map/wikiLayer';
import { ALPR_COLOR } from '../map/alprLayer';
import { CAM_COLOR, WEBCAM_COLOR } from '../map/camLayer';
import { type SeaFilters, VESSEL_COLOR } from '../map/vesselLayer';
import { aircraftColor } from '../map/aircraftLayer';
import { BASE_KINDS, FUEL_COLOR } from '../map/infraLayer';
import { alertColor } from '../map/wxLayer';
import { ago, SEVERITY_COLOR, TYPE_INFO } from '../lib/format';
import { setHover } from '../lib/hover';
import type { AirspaceFilters } from '../map/airspaceLayer';
import Globe, { type Basemap, BASEMAPS, type GlobeHandle, type Imagery, PHOTO_3D } from '../map/Globe';
import { applyLayers, buildShareLink, takeShareLink, FLY_KEY } from '../lib/share';

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
  // Built-in defaults, then the server's (an admin's), then the user's own.
  const base = serverFilters(me.defaults?.layers);
  return {
    ...base,
    types: { ...base.types, ...(saved ?? {}) },
    air: { ...base.air, ...(air ?? {}) },
    reference: { ...base.reference, ...(reference ?? {}) },
    space: { ...base.space, ...((me.preferences.space as Partial<SpaceFilters> | undefined) ?? {}) },
    sea: { ...base.sea, ...((me.preferences.sea as Partial<SeaFilters> | undefined) ?? {}) },
    infra: { ...base.infra, ...((me.preferences.infra as Record<string, boolean> | undefined) ?? {}) },
    airspace: {
      ...base.airspace,
      ...((me.preferences.airspace as Partial<AirspaceFilters> | undefined) ?? {}),
    },
    tension: typeof me.preferences.tension === 'boolean' ? me.preferences.tension : base.tension,
    wiki: typeof me.preferences.wiki === 'boolean' ? me.preferences.wiki : base.wiki,
    cams: { ...base.cams, ...((me.preferences.cams as Partial<LayerFilters['cams']> | undefined) ?? {}) },
    weather: { ...base.weather, ...((me.preferences.weather as Partial<LayerFilters['weather']> | undefined) ?? {}) },
  };
}

function wikiNote(w: WikiItem | undefined): string {
  if (!w) return '';
  const thread = w.topics.length ? ' Story: ' + w.topics.join(' › ') + '.' : '';
  return (
    w.text +
    thread +
    (w.place ? ' Placed at ' + w.place + '.' : '') +
    ' (Wikipedia, Portal:Current events, CC BY-SA 4.0.)'
  );
}

function wikiLinks(w: WikiItem | undefined): { label: string; url: string }[] {
  if (!w) return [];
  return [
    { label: 'Wikipedia, ' + w.date, url: w.url },
    ...w.sources.slice(0, 4).map((s) => ({ label: s.name || 'Source', url: s.url })),
  ];
}

function advisoryLinks(a: Advisory | undefined): { label: string; url: string }[] {
  if (!a) return [];
  const out = [];
  if (a.us?.url) out.push({ label: 'US State Department advisory', url: a.us.url });
  if (a.uk?.url) out.push({ label: 'UK foreign travel advice', url: a.uk.url });
  return out;
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
  const [newsTabs, setNewsTabs] = useState<string[]>(savedNews.tabs ?? me.defaults?.news?.tabs ?? DEFAULT_TABS);
  const saveNews = (players: string[], tabs: string[]) => {
    setNewsPlayers(players);
    setNewsTabs(tabs);
    void savePreferences({
      news: { open: players.length > 0, channel: players[0] ?? savedNews.channel, tabs, players },
    }).catch(() => undefined);
  };
  const [airspaceItems, setAirspaceItems] = useState<AirspaceItem[]>([]);
  const [selectedAirspace, setSelectedAirspace] = useState<string | null>(null);
  // GPS cells, tension countries and drawings (InfoInspector).
  const [selectedInfo, setSelectedInfo] = useState<string | null>(null);
  const [gpsCells, setGpsCells] = useState<GpsCell[]>([]);
  const [tension, setTension] = useState<Tension | null>(null);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [wikiItems, setWikiItems] = useState<WikiItem[]>([]);
  // Weather: NWS warnings (mapped, and those for home), SPC outlooks and
  // current conditions at home.
  const [wxAlerts, setWxAlerts] = useState<WxAlert[]>([]);
  const [wxZoned, setWxZoned] = useState<WxAlert[]>([]);
  const [homeAlerts, setHomeAlerts] = useState<WxAlert[]>([]);
  const [outlook, setOutlook] = useState<OutlookArea[]>([]);
  const [weatherNow, setWeatherNow] = useState<WeatherNow | null>(null);
  const [structureItems, setStructureItems] = useState<AirspaceItem[]>([]);
  const [trafficCams, setTrafficCams] = useState<TrafficCam[]>([]);
  const [camStatus, setCamStatus] = useState<'ok' | 'zoom'>('zoom');
  const [selectedCam, setSelectedCam] = useState<TrafficCam | null>(null);
  const [webcams, setWebcams] = useState<Webcam[]>([]);
  const [webcamStatus, setWebcamStatus] = useState<string>('zoom');
  const [selectedWebcam, setSelectedWebcam] = useState<Webcam | null>(null);
  const [alprCameras, setAlprCameras] = useState<AlprCamera[]>([]);
  const [selectedAlpr, setSelectedAlpr] = useState<string | null>(null);
  const [alprStatus, setAlprStatus] = useState<AlprStatus>('zoom');
  const alprTimer = useRef<number | undefined>(undefined);
  const [structureStatus, setStructureStatus] = useState<'ok' | 'zoom' | 'nokey' | 'blocked' | 'error'>('zoom');
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
  const [showRoute, setShowRoute] = useState(me.preferences.show_route !== false);
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

  // ALPR cameras for the view (regional views only). The API fetches a
  // couple of new tiles per call, so while it says "partial" ask again.
  const loadAlpr = useCallback(async () => {
    window.clearTimeout(alprTimer.current);
    const bbox = viewRef.current;
    if (!filtersRef.current.infra.alpr) return;
    if (!bbox) {
      setAlprStatus('zoom');
      setAlprCameras([]);
      return;
    }
    setAlprStatus((s) => (s === 'zoom' ? 'partial' : s));
    try {
      const r = await getAlpr(bbox);
      if (viewRef.current !== bbox) {
        // The view moved while Overpass answered: ask for the new one.
        alprTimer.current = window.setTimeout(() => void loadAlpr(), 500);
        return;
      }
      setAlprStatus(r.status);
      setAlprCameras(r.cameras);
      if (r.status === 'partial') alprTimer.current = window.setTimeout(() => void loadAlpr(), 3000);
    } catch {
      // A slow first fetch can time out: try again shortly.
      alprTimer.current = window.setTimeout(() => void loadAlpr(), 5000);
    }
  }, []);

  // Windy webcams for the view (regional views only; image links last a
  // few minutes, so the list is asked for again every five).
  const loadWebcams = useCallback(async () => {
    const bbox = viewRef.current;
    if (!filtersRef.current.cams.webcams) return;
    if (!bbox) {
      setWebcamStatus('zoom');
      setWebcams([]);
      return;
    }
    try {
      const r = await getWebcams(bbox);
      if (viewRef.current !== bbox) return;
      setWebcamStatus(r.status);
      setWebcams(r.items);
    } catch {
      setWebcamStatus('error');
    }
  }, []);
  useEffect(() => {
    if (!filters.cams.webcams) {
      setWebcams([]);
      return;
    }
    void loadWebcams();
    const id = window.setInterval(() => void loadWebcams(), 300_000);
    return () => window.clearInterval(id);
  }, [filters.cams.webcams, loadWebcams]);

  // Traffic cameras for the view (regional views only).
  const loadCams = useCallback(async () => {
    const bbox = viewRef.current;
    if (!filtersRef.current.cams.traffic) return;
    if (!bbox) {
      setCamStatus('zoom');
      setTrafficCams([]);
      return;
    }
    try {
      const r = await getCams(bbox);
      if (viewRef.current !== bbox) return;
      setCamStatus(r.status);
      setTrafficCams(r.cameras);
    } catch {
      // Keep what's shown; the next view change retries.
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
  // The whole catalogue (about 17,000) only when a satellite layer or a
  // satellite is chosen; Space stations on its own needs just a few.
  const fullCatalog =
    filters.space.leo ||
    filters.space.meo ||
    filters.space.geo ||
    filters.space.heo ||
    filters.space.starlink ||
    selectedNorad !== null;
  const satMode: 'none' | 'stations' | 'all' = fullCatalog ? 'all' : filters.space.iss ? 'stations' : 'none';
  const wantSats = satMode !== 'none';
  useEffect(() => {
    if (!wantSats) return;
    let cancelled = false;
    async function load() {
      try {
        const body = await getSatelliteCatalog(satMode === 'stations' ? 'station' : undefined);
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
    void load();
    const id = window.setInterval(() => void load(), 3_600_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Loaded again when the mode changes (stations only, or everything);
    // the interval refreshes it.
  }, [satMode]);
  const satCounts = useMemo(() => {
    const c: Partial<Record<keyof SpaceFilters, number>> = {};
    // Counts mean something only with the whole catalogue loaded.
    for (const m of satMode === 'all' ? (satCatalog?.meta ?? []) : []) {
      const k = m.tags.includes('starlink') ? 'starlink' : m.cls;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [satCatalog, satMode]);

  const viewTimer = useRef<number | undefined>(undefined);
  const [legendOpen, setLegendOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ lat: number; lon: number; x: number; y: number } | null>(null);

  // Drawing, measuring and area selection (map/drawTools.ts), with the
  // user's drawings saved in their preferences.
  const [drawings, setDrawings] = useState<Drawing[]>(() =>
    Array.isArray(me.preferences.drawings) ? (me.preferences.drawings as Drawing[]) : [],
  );
  const [tool, setToolState] = useState<Tool>('none');
  const [toolHint, setToolHint] = useState<string | null>(null);
  const [notePrompt, setNotePrompt] = useState<{ at: [number, number]; x: number; y: number } | null>(null);
  const [areaSel, setAreaSel] = useState<AreaSelection | null>(null);
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const saveDrawings = useCallback((next: Drawing[]) => {
    setDrawings(next);
    void savePreferences({ drawings: next.slice(-200) }).catch(() => undefined);
  }, []);
  const chooseTool = useCallback((t: Tool) => {
    globe.current?.drawTool()?.setTool(t);
    setToolState(t);
    if (t === 'none') setNotePrompt(null);
  }, []);
  const selectInAreaRef = useRef<(ring: [number, number][]) => void>(() => undefined);
  const imageryAreaRef = useRef<(ring: [number, number][]) => void>(() => undefined);
  // Recent imagery over a drawn box (ImageryPanel); stays on the map
  // until removed.
  const [sentinel, setSentinel] = useState<ImageryState | null>(null);
  useEffect(() => {
    globe.current?.showSentinel(
      sentinel?.tiles
        ? {
            box: sentinel.box,
            tiles: sentinel.tiles,
            before: sentinel.beforeTiles,
            alpha: sentinel.alpha,
            split: sentinel.split,
          }
        : null,
    );
  }, [sentinel]);
  const drawCallbacks = useMemo<DrawCallbacks>(
    () => ({
      onDrawn: (d) => saveDrawings([...drawingsRef.current, d]),
      onSelectArea: (ring) => selectInAreaRef.current(ring),
      onImageryArea: (ring) => imageryAreaRef.current(ring),
      onDelete: (id) => saveDrawings(drawingsRef.current.filter((d) => d.id !== id)),
      onText: (at, screen) => setNotePrompt({ at, x: screen.x, y: screen.y }),
      onHint: (hint) => setToolHint(hint),
    }),
    [saveDrawings],
  );

  async function capture() {
    const blob = await globe.current?.capture();
    if (!blob) {
      setNotice("Couldn't capture the map.");
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'argus-map-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // The map item under the pointer, for the hover card (lib/hover.ts).
  const onHover = useCallback((id: string | null, x: number, y: number) => {
    setHover(id ? { id, x, y } : null);
  }, []);

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
        void loadAlpr();
        void loadCams();
        void loadWebcams();
      }, 400);
    },
    [loadCivil, loadVessels, loadStructure, loadAlpr, loadCams, loadWebcams],
  );
  useEffect(() => {
    if (filters.airspace.structure) void loadStructure();
  }, [filters.airspace.structure, loadStructure]);
  useEffect(() => {
    if (filters.cams.traffic) void loadCams();
    else setTrafficCams([]);
  }, [filters.cams.traffic, loadCams]);
  useEffect(() => {
    if (filters.infra.alpr) void loadAlpr();
    else setAlprCameras([]);
  }, [filters.infra.alpr, loadAlpr]);

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

  // Timeline replay: the map shows events as they were at the cursor, and
  // only those inside a Shift-drag filter. Aircraft and ships stay live
  // (Argus doesn't keep their history).
  const [replay, setReplay] = useState<Replay>(LIVE);
  useEffect(() => {
    if (!replay.playing) return;
    const step = 250;
    const id = window.setInterval(() => {
      setReplay((r) => {
        if (!r.playing || r.t === null) return r;
        const end = r.to ?? Date.now();
        const begin = r.from ?? Date.now() - filters.hours * 3_600_000;
        const next = r.t + r.speed * step;
        // Loop within the window (or the filter), as Foundry Map does.
        return { ...r, t: next > end ? begin : next };
      });
    }, step);
    return () => window.clearInterval(id);
  }, [replay.playing, filters.hours]);
  const mapEvents = useMemo(() => {
    if (replay.t === null && replay.from === null) return shown;
    return shown.filter((e) => {
      const t = Date.parse(e.first_seen);
      if (replay.t !== null && t > replay.t) return false;
      if (replay.from !== null && replay.to !== null && (t < replay.from || t > replay.to)) return false;
      return true;
    });
  }, [shown, replay.t, replay.from, replay.to]);
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
  const bridgeVessel = selectedMmsi !== null ? (shownVessels.find((x) => x.mmsi === selectedMmsi) ?? null) : null;
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

  // NWS alerts every two minutes (also for the home card); SPC outlook
  // half-hourly while its layer is on; home weather every 15 minutes.
  const homeKey = me.preferences.home ? me.preferences.home.lat + ',' + me.preferences.home.lon : '';
  useEffect(() => {
    let cancelled = false;
    const h = me.preferences.home ?? null;
    const load = () =>
      getWxAlerts(h, filters.weather.zones)
        .then((r) => {
          if (cancelled) return;
          setWxAlerts(r.alerts);
          setWxZoned(r.zoned ?? []);
          setHomeAlerts(r.local);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [homeKey, filters.weather.zones]);
  useEffect(() => {
    if (!filters.weather.outlook) return;
    let cancelled = false;
    const load = () =>
      getOutlook()
        .then((r) => !cancelled && setOutlook(r.areas))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 1_800_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [filters.weather.outlook]);
  useEffect(() => {
    const h = me.preferences.home;
    if (!h) return;
    let cancelled = false;
    const load = () =>
      getWeatherNow(h.lat, h.lon)
        .then((r) => !cancelled && setWeatherNow(r))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 900_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [homeKey]);

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

  // Travel advisories while the layer is on (the worker refreshes them
  // every six hours; check every half hour).
  const advisoriesOn = filters.reference.advisories;
  useEffect(() => {
    if (!advisoriesOn) return;
    let cancelled = false;
    const load = () =>
      getAdvisories()
        .then((r) => !cancelled && setAdvisories(r.countries))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 1_800_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [advisoriesOn]);

  // Wikipedia current events while the layer is on (the worker reads
  // them hourly).
  const wikiOn = filters.wiki;
  useEffect(() => {
    if (!wikiOn) return;
    let cancelled = false;
    const load = () =>
      getWikipedia()
        .then((r) => !cancelled && setWikiItems(r.items))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 1_800_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [wikiOn]);

  // FAA airport status while the airports layer is on (the API caches
  // it two minutes): rings airports with ground stops or delays.
  const airportsOn = filters.reference.airports;
  const [faa, setFaa] = useState<FaaStatus | null>(null);
  useEffect(() => {
    if (!airportsOn) return;
    let cancelled = false;
    const load = () =>
      getFaaStatus()
        .then((r) => !cancelled && setFaa(r))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [airportsOn]);
  useEffect(() => {
    const rings: Record<string, string> = {};
    for (const [code, items] of Object.entries(faa?.airports ?? {})) {
      const level = faaLevel(items);
      if (level) rings[code] = FAA_COLOR[level];
    }
    globe.current?.setAirportRings(rings);
  }, [faa]);

  // Airspace areas, while any airspace layer is on (every 10 minutes).
  const airspaceOn = filters.airspace.tfr || filters.airspace.sigmet || filters.airspace.czib;
  // GPS cells load even with the layer off: Situation counts them.
  useEffect(() => {
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
  }, []);
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
  const selectedAirport = selectedInfra?.startsWith('apt:')
    ? (globe.current?.airport(Number(selectedInfra.slice(4))) ?? null)
    : null;
  const selectedPort = selectedInfra?.startsWith('port:')
    ? (globe.current?.port(Number(selectedInfra.slice(5))) ?? null)
    : null;

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
      wiki: next.wiki,
      cams: next.cams,
      weather: next.weather,
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
    setAreaSel(null);
    setSelectedInfo(null);
    setSelected(null);
    setSelectedHex(null);
    setSelectedNorad(null);
    setSelectedMmsi(null);
    setTrackedVessel(null);
    setSelectedAirspace(null);
    setSelectedInfra(null);
    setSelectedCam(null);
    setSelectedWebcam(null);
    setSelectedAlpr(null);
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
      // An active drawing or selection tool takes Esc, Enter and Backspace.
      const dt = globe.current?.drawTool();
      if (dt && dt.tool() !== 'none') {
        if (e.key === 'Escape') {
          dt.cancel();
          if (dt.tool() === 'none') chooseTool('none');
          return;
        }
        if (e.key === 'Enter') return dt.finish();
        if (e.key === 'Backspace') {
          e.preventDefault();
          return dt.undo();
        }
      }
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
  }, [togglePanel, clearSelection, camera, selectedHex, selectedMmsi, chooseTool]);

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
  // Director mode: saved tours (preferences), a tour opened from a link,
  // and playback (one tour at a time; a newer play or Stop ends it).
  const [toursOpen, setToursOpen] = useState(false);
  const [tours, setTours] = useState<Tour[]>(
    () => ((me.preferences.tours as unknown[] | undefined) ?? []).map(cleanTour).filter((t): t is Tour => t !== null),
  );
  const [sharedTour, setSharedTour] = useState<Tour | null>(null);
  const [activeTour, setActiveTour] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; index: number } | null>(null);
  const playToken = useRef(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const saveTours = (next: Tour[]) => {
    setTours(next);
    // Typing a caption saves once it pauses.
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => void savePreferences({ tours: next }).catch(() => undefined),
      800,
    );
  };
  const stopTour = () => {
    playToken.current++;
    setPlaying(null);
  };
  async function playTour(t: Tour, from: number) {
    const token = ++playToken.current;
    const live = () => playToken.current === token;
    let i = from;
    while (live() && t.shots.length) {
      if (i >= t.shots.length) {
        if (!t.loop) break;
        i = 0;
      }
      const shot = t.shots[i];
      setPlaying({ id: t.id, index: i });
      const done = await globe.current?.flyCamera(shot.camera, shot.fly_s);
      // Someone moved the map mid-flight: hand it back to them.
      if (!live() || done === false) break;
      const until = Date.now() + shot.hold_s * 1000;
      while (live() && Date.now() < until) await new Promise((r) => window.setTimeout(r, 200));
      i++;
    }
    if (live()) setPlaying(null);
  }
  const playingTour = playing ? [sharedTour, ...tours].find((t) => t?.id === playing.id) : null;
  const playingShot = playingTour?.shots[playing?.index ?? -1] ?? null;
  useEffect(() => () => stopTour(), []);

  function applyShare() {
    // A theatre picked on the Brief page.
    try {
      const fly = sessionStorage.getItem(FLY_KEY);
      if (fly) {
        sessionStorage.removeItem(FLY_KEY);
        const f = JSON.parse(fly) as { lat: number; lon: number; height: number; event?: string };
        globe.current?.flyTo(f.lat, f.lon, f.height);
        if (f.event) select(f.event);
      }
    } catch {
      // Storage blocked or bad value: stay where the map is.
    }
    const share = takeShareLink();
    if (!share) return;
    if (share.tour) {
      const t = share.tour;
      clearSelection();
      setSharedTour(t);
      setActiveTour(t.id);
      setToursOpen(true);
      openRight();
      // Let the globe settle first.
      window.setTimeout(() => void playTour(t, 0), 1500);
      return;
    }
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
    if (
      id &&
      (id.startsWith('pp:') ||
        id.startsWith('cable:') ||
        id.startsWith('mil:') ||
        id.startsWith('apt:') ||
        id.startsWith('port:'))
    ) {
      clearSelection();
      setSelectedInfra(id);
      openRight();
      return;
    }
    if (id && id.startsWith('alpr:')) {
      clearSelection();
      setSelectedAlpr(id.slice(5));
      openRight();
      return;
    }
    if (id && id.startsWith('webcam:')) {
      const cam = webcams.find((c) => 'webcam:' + c.id === id);
      if (cam) {
        clearSelection();
        setSelectedWebcam(cam);
        openRight();
      }
      return;
    }
    if (id && id.startsWith('cam:')) {
      const cam = trafficCams.find((c) => 'cam:' + c.id === id);
      if (cam) {
        clearSelection();
        setSelectedCam(cam);
        openRight();
      }
      return;
    }
    if (id && id.startsWith('air:')) {
      clearSelection();
      setSelectedAirspace(id.slice(4));
      openRight();
      return;
    }
    // Map items that aren't events: a small info panel, never the event
    // lookup (it would only say there's no such event).
    if (
      id &&
      (id.startsWith('gps:') ||
        id.startsWith('tension:') ||
        id.startsWith('adv:') ||
        id.startsWith('wiki:') ||
        id.startsWith('draw:') ||
        id.startsWith('wx:') ||
        id.startsWith('spc:'))
    ) {
      clearSelection();
      setSelectedInfo(id);
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
  // Select tools: everything on the map inside the drawn area.
  imageryAreaRef.current = (ring) => {
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const box: ImageryState['box'] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    chooseTool('none');
    clearSelection();
    setSentinel(newImagery(box));
    openRight();
  };

  selectInAreaRef.current = (ring) => {
    const inside = (lat: number, lon: number) => inRing([lon, lat], ring);
    clearSelection();
    setAreaSel({
      ring,
      events: shown.filter((e) => inside(e.lat, e.lon)),
      aircraft: aircraft.filter((a) => inside(a.lat, a.lon)),
      vessels: vessels.filter((v) => inside(v.lat, v.lon)),
    });
    chooseTool('none');
    openRight();
  };

  // What the hover card says about a map item.
  function hoverInfo(id: string): HoverInfo | null {
    if (id.startsWith('ac:')) {
      const a = aircraft.find((x) => x.hex === id.slice(3));
      if (!a) return null;
      const alt = a.ground ? 'on ground' : a.alt_ft !== null ? 'FL' + Math.round(a.alt_ft / 100) : '';
      return {
        title: (a.callsign || a.reg || a.hex.toUpperCase()) + (a.type ? ' · ' + a.type : ''),
        color: aircraftColor(a),
        lines: [
          [a.mil ? (a.role ?? 'Military') : 'Civil', alt, a.gs_kt !== null ? Math.round(a.gs_kt) + ' kt' : '']
            .filter(Boolean)
            .join(' · '),
          a.emergency ? 'Emergency · squawk ' + a.squawk : '',
        ],
      };
    }
    if (id.startsWith('ship:')) {
      const v = vessels.find((x) => x.mmsi === Number(id.slice(5)));
      if (!v) return null;
      return {
        title: v.name || 'MMSI ' + v.mmsi,
        color: VESSEL_COLOR[v.category],
        lines: [
          [v.type, v.flag, v.sog !== null ? v.sog.toFixed(1) + ' kn' : ''].filter(Boolean).join(' · '),
          v.destination ? '→ ' + v.destination : '',
        ],
      };
    }
    if (id.startsWith('sat:')) {
      const m = satCatalog?.meta.find((x) => x.norad === Number(id.slice(4)));
      return m ? { title: m.name, lines: [m.cls.toUpperCase() + ' · NORAD ' + m.norad + ' · ' + m.cospar] } : null;
    }
    if (id.startsWith('air:')) {
      const item = [...airspaceItems, ...structureItems].find((x) => x.key === id.slice(4));
      if (!item) return null;
      const limits =
        item.base_ft !== null || item.top_ft !== null ? (item.base_ft ?? 'SFC') + ' – ' + (item.top_ft ?? 'UNL') + ' ft' : '';
      return { title: item.title || item.id, lines: [[item.hazard, item.area].filter(Boolean).join(' · '), limits] };
    }
    if (id.startsWith('gps:')) {
      const c = gpsCells.find((x) => 'gps:' + x.id === id);
      return c
        ? {
            title: 'GPS interference',
            color: '#ff6ba1',
            lines: [Math.round(c.share * 100) + '% of ' + c.aircraft + ' aircraft degraded · last hour'],
          }
        : null;
    }
    if (id.startsWith('webcam:')) {
      const c = webcams.find((x) => 'webcam:' + x.id === id);
      return c ? { title: c.title, color: WEBCAM_COLOR, lines: [c.place ?? 'Webcam', 'windy.com'] } : null;
    }
    if (id.startsWith('cam:')) {
      const c = trafficCams.find((x) => 'cam:' + x.id === id);
      return c
        ? { title: c.name, color: CAM_COLOR, lines: [[c.road, c.place, c.agency].filter(Boolean).join(' · ')] }
        : null;
    }
    if (id.startsWith('alpr:')) {
      const c = alprCameras.find((x) => 'alpr:' + x.id === id);
      return c
        ? {
            title: 'Plate reader · ' + c.vendor,
            color: ALPR_COLOR,
            lines: [
              c.operator ? 'Operator: ' + c.operator : 'Operator not mapped',
              (c.direction !== null ? 'Faces ' + Math.round(c.direction) + '°' : 'Direction not mapped') +
                (c.mapped ? ' · mapped ' + c.mapped : ''),
            ],
          }
        : null;
    }
    if (id.startsWith('wiki:')) {
      const w = wikiItems.find((x) => 'wiki:' + x.id === id);
      return w
        ? {
            title: w.topics[w.topics.length - 1] || w.category,
            color: w.category.startsWith('Armed') ? WIKI_CONFLICT_COLOR : WIKI_COLOR,
            lines: [w.text.length > 160 ? w.text.slice(0, 157) + '…' : w.text, w.category + ' · ' + w.date],
          }
        : null;
    }
    if (id.startsWith('adv:')) {
      const a = advisories.find((x) => x.country === id.slice(4));
      return a
        ? {
            title: a.country + ' · travel advisories',
            color: ADVISORY_COLOR[a.level],
            lines: [
              a.us ? 'US: Level ' + a.us.level + ', ' + a.us.label.toLowerCase() : 'US: no advisory listed',
              a.uk ? 'UK: ' + a.uk.label : 'UK: no advice listed',
            ],
          }
        : null;
    }
    if (id.startsWith('tension:')) {
      const c = tension?.countries.find((x) => x.name === id.slice(8));
      return c
        ? {
            title: c.name + ' · ' + c.level,
            color: '#ff5260',
            lines: [BAND_LABEL[c.band] + ' · ' + c.deaths_12m.toLocaleString() + ' deaths in 12 months (UCDP)'],
          }
        : null;
    }
    if (id.startsWith('pp:')) {
      const p = globe.current?.plant(Number(id.slice(3)));
      return p
        ? {
            title: p[0],
            color: FUEL_COLOR[p[2]] ?? FUEL_COLOR.Other,
            lines: [p[2] + ' · ' + p[3].toLocaleString() + ' MW · ' + p[1]],
          }
        : null;
    }
    if (id.startsWith('apt:')) {
      const a = globe.current?.airport(Number(id.slice(4)));
      if (!a) return null;
      const items = faa?.airports[a[0]] ?? [];
      const level = faaLevel(items);
      return {
        title: a[1],
        color: level ? FAA_COLOR[level] : '#b4c2d4',
        lines: [a[0] + ' · airport', ...items.slice(0, 3).map((i) => faaLine(i).title)],
      };
    }
    if (id.startsWith('port:')) {
      const p = globe.current?.port(Number(id.slice(5)));
      return p
        ? {
            title: p[1],
            color: '#4fc1b0',
            lines: [(p[5] ? 'Sea port' : 'River or inland port') + ' · ' + p[0]],
          }
        : null;
    }
    if (id.startsWith('mil:')) {
      const b = globe.current?.base(Number(id.slice(4)));
      return b ? { title: b[0], lines: [BASE_KINDS[b[1]] ?? b[1], b[4]] } : null;
    }
    if (id.startsWith('wx:')) {
      const a = [...wxAlerts, ...wxZoned].find((x) => x.key === id.slice(3));
      return a
        ? {
            title: a.event,
            color: alertColor(a),
            lines: [a.area.slice(0, 120), (a.sender ?? '') + (a.expires ? ' · until ' + new Date(a.expires).toLocaleString() : '')],
          }
        : null;
    }
    if (id.startsWith('spc:')) {
      const o = outlook.find((x) => x.key === id.slice(4));
      return o ? { title: o.title, color: o.fill ?? '#66a366', lines: ['SPC Day ' + o.day + ' outlook'] } : null;
    }
    if (id.startsWith('draw:')) {
      const d = drawings.find((x) => x.id === id.slice(5));
      if (!d) return null;
      const kind = { point: 'Point', line: 'Line', polygon: 'Area', rectangle: 'Rectangle', circle: 'Circle', text: 'Note', measure: 'Measurement' }[d.kind];
      return { title: d.label || kind, color: '#5b9bff', lines: [kind + (describeShape(d) ? ' · ' + describeShape(d) : '')] };
    }
    if (id.startsWith('cable:')) {
      const c = globe.current?.cable(id.slice(6));
      return c ? { title: c.name, lines: ['Submarine cable'] } : null;
    }
    const e = events.find((x) => x.id === id);
    if (!e) return null;
    return {
      title: e.title,
      color: SEVERITY_COLOR[e.severity],
      lines: [
        TYPE_INFO[e.type].label + ' · ' + e.severity_name + (e.status === 'candidate' ? ' · unconfirmed' : ''),
        e.place + ' · ' + ago(e.last_updated),
      ],
    };
  }

  // Double-click: follow aircraft, ships and satellites; zoom to events.
  function focus(id: string) {
    if (id.startsWith('ac:')) {
      selectAircraft(id.slice(3), 'follow');
      return;
    }
    if (id.startsWith('ship:')) {
      selectVessel(Number(id.slice(5)), 'follow');
      return;
    }
    if (id.startsWith('sat:')) {
      selectSatellite(Number(id.slice(4)), true);
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
      <AppHeader
        me={me}
        onSignedOut={onSignedOut}
        live={live}
        replay={replay.t !== null}
        search={<SearchBox onPick={onSearch} />}
      />
      <main className={'ws' + (leftOpen ? '' : ' noL') + (rightOpen ? '' : ' noR')}>
        {leftOpen && (
          <LayerPanel
            filters={filters}
            counts={counts}
            tensionCount={tension ? tension.countries.filter((c) => c.level >= TINT_FROM).length : undefined}
            advisoryCount={advisoriesOn ? advisories.filter((a) => a.level >= 2).length : undefined}
            wikiCount={wikiOn ? wikiItems.length : undefined}
            alprCount={filters.infra.alpr && alprStatus !== 'zoom' ? alprCameras.length : undefined}
            alprLoading={filters.infra.alpr && alprStatus === 'partial'}
            camCount={filters.cams.traffic && camStatus !== 'zoom' ? trafficCams.length : undefined}
            webcamCount={webcamStatus === 'ok' ? webcams.length : undefined}
            webcamNote={
              webcamStatus === 'zoom'
                ? 'zoom in'
                : webcamStatus === 'nokey'
                  ? 'no key'
                  : webcamStatus === 'error'
                    ? 'error'
                    : undefined
            }
            weatherCount={filters.weather.alerts ? wxAlerts.length : undefined}
            zoneCount={filters.weather.zones ? wxZoned.length : undefined}
            airCounts={airCounts}
            civilStatus={civilStatus}
            satCounts={satCounts}
            seaCounts={seaCounts}
            seaStatus={seaStatus}
            airspaceCounts={airspaceCounts}
            structureStatus={structureStatus}
            sources={summary?.sources ?? []}
            resetTo={serverFilters(me.defaults?.layers)}
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
            advisories={advisories}
            wikiItems={wikiItems}
            showWiki={filters.wiki}
            alprCameras={alprCameras}
            trafficCams={filters.cams.traffic ? trafficCams : []}
            webcams={filters.cams.webcams ? webcams : []}
            selectedCam={selectedCam?.id ?? null}
            wxAlerts={wxAlerts}
            wxZoned={wxZoned}
            outlook={outlook}
            weather={filters.weather}
            showTension={filters.tension}
            infra={filters.infra}
            home={home}
            events={mapEvents}
            selectedId={selected}
            onSelect={select}
            onFocus={focus}
            onHover={onHover}
            onContext={(lat, lon, x, y) => setCtxMenu({ lat, lon, x, y })}
            drawings={drawings}
            route={
              showRoute && selectedHex && tracked && trackedRoute?.origin?.lat != null && trackedRoute.destination?.lat != null
                ? {
                    origin: [trackedRoute.origin.lon ?? 0, trackedRoute.origin.lat],
                    destination: [trackedRoute.destination.lon ?? 0, trackedRoute.destination.lat],
                    at: [tracked.lon, tracked.lat],
                    labels: [
                      trackedRoute.origin.iata ?? trackedRoute.origin.icao ?? '',
                      trackedRoute.destination.iata ?? trackedRoute.destination.icao ?? '',
                    ],
                  }
                : null
            }
            drawCallbacks={drawCallbacks}
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
            <button
              className={'btn mapbtn' + (newsPlayers.length ? ' on' : '')}
              title="Live news channels"
              aria-label="Live news"
              aria-pressed={newsPlayers.length > 0}
              onClick={() => saveNews(newsPlayers.length ? [] : [savedNews.channel ?? newsTabs[0] ?? DEFAULT_TABS[0]], newsTabs)}
            >
              ▶ News
            </button>
            <button
              className={'btn mapbtn' + (legendOpen ? ' on' : '')}
              aria-pressed={legendOpen}
              title="What the colours mean"
              onClick={() => setLegendOpen(!legendOpen)}
            >
              Legend
            </button>
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
          {camera === 'cockpit' && selectedHex && tracked && (
            <CockpitHud
              aircraft={tracked}
              reportedAt={trackedAt}
              destination={trackedRoute?.destination ?? null}
              attitude={() => globe.current?.attitude() ?? null}
            />
          )}
          {camera === 'cockpit' && bridgeVessel && (
            <BridgeHud vessel={bridgeVessel} attitude={() => globe.current?.attitude() ?? null} />
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
          <HoverLayer describe={hoverInfo} />
          {playingShot?.caption && <div className="tourcaption">{playingShot.caption}</div>}
          {ctxMenu && (
            <MapContextMenu
              {...ctxMenu}
              onClose={() => setCtxMenu(null)}
              onCentre={() => globe.current?.flyTo(ctxMenu.lat, ctxMenu.lon)}
              onCopied={setNotice}
            />
          )}
          <div className="mc tl2">
            <MapToolbar
              tool={tool}
              onTool={chooseTool}
              onCapture={() => void capture()}
              onClear={() => {
                if (window.confirm('Delete all ' + drawings.length + ' drawings? This cannot be undone.')) saveDrawings([]);
              }}
              drawingCount={drawings.length}
              toursOpen={toursOpen}
              onTours={() => {
                if (toursOpen) setToursOpen(false);
                else {
                  clearSelection();
                  setToursOpen(true);
                  openRight();
                }
              }}
            />
          </div>
          {toolHint && <div className="toolhint">{toolHint}</div>}
          {notePrompt && (
            <form
              className="noteprompt"
              style={{ left: notePrompt.x, top: notePrompt.y }}
              onSubmit={(e) => {
                e.preventDefault();
                const text = String(new FormData(e.currentTarget).get('note') ?? '').trim();
                if (text) {
                  saveDrawings([
                    ...drawings,
                    { id: Date.now().toString(36), kind: 'text', points: [notePrompt.at], label: text.slice(0, 120) },
                  ]);
                }
                setNotePrompt(null);
              }}
            >
              <input
                name="note"
                autoFocus
                maxLength={120}
                placeholder="Note text, then Enter"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNotePrompt(null);
                }}
              />
            </form>
          )}
          {legendOpen && <Legend filters={filters} onClose={() => setLegendOpen(false)} />}
          <div className="mc bl">
            <CursorReadout />
          </div>
          <div className="mc br">
            <ScaleBar />
          </div>
        </section>
        <Timeline events={shown} hours={filters.hours} replay={replay} onReplay={setReplay} />
        {rightOpen && (
          <aside className="side right" aria-label="Inspector">
            {selectedWebcam ? (
              <WebcamInspector cam={selectedWebcam} onBack={() => setSelectedWebcam(null)} />
            ) : selectedAlpr && alprCameras.some((c) => c.id === selectedAlpr) ? (
              <AlprInspector
                cam={alprCameras.find((c) => c.id === selectedAlpr) as AlprCamera}
                inView={alprCameras}
                onBack={() => setSelectedAlpr(null)}
              />
            ) : selectedCam ? (
              <CamInspector cam={selectedCam} onBack={() => setSelectedCam(null)} />
            ) : selectedInfo ? (
              <InfoInspector
                info={hoverInfo(selectedInfo)}
                note={
                  selectedInfo.startsWith('gps:')
                    ? 'GPS interference: the share of aircraft in this hexagon reporting a degraded position (NACp below 8) over the last hour, from the aircraft Argus sees. Not for navigation.'
                    : selectedInfo.startsWith('wx:')
                      ? ([...wxAlerts, ...wxZoned].find((x) => 'wx:' + x.key === selectedInfo)?.description ?? '') +
                        ' (National Weather Service; open the alert for its full text and instructions.)'
                      : selectedInfo.startsWith('spc:')
                        ? 'Storm Prediction Center convective outlook: the chance of severe thunderstorms (tornadoes, damaging wind, large hail) on a 1–5 scale, Marginal to High.'
                        : selectedInfo.startsWith('wiki:')
                          ? wikiNote(wikiItems.find((x) => 'wiki:' + x.id === selectedInfo))
                          : selectedInfo.startsWith('adv:')
                          ? (advisories.find((x) => 'adv:' + x.country === selectedInfo)?.us?.summary ?? '') +
                            ' (US Department of State and UK FCDO; open the advice for the full text.)'
                          : selectedInfo.startsWith('tension:')
                      ? 'Tension: organised violence over the last year (UCDP) plus confirmed live events. See World tension in the Situation panel.'
                      : 'A shape you drew. Delete it with the Delete tool.'
                }
                links={
                  selectedInfo.startsWith('wiki:')
                    ? wikiLinks(wikiItems.find((x) => 'wiki:' + x.id === selectedInfo))
                    : advisoryLinks(advisories.find((x) => 'adv:' + x.country === selectedInfo))
                }
                onBack={() => setSelectedInfo(null)}
              />
            ) : areaSel ? (
              <SelectionPanel
                sel={areaSel}
                onBack={() => setAreaSel(null)}
                onEvent={(id) => {
                  setAreaSel(null);
                  selectAndFly(id);
                }}
                onAircraft={(hex) => {
                  setAreaSel(null);
                  selectAircraft(hex, 'follow');
                }}
                onVessel={(mmsi) => {
                  setAreaSel(null);
                  selectVessel(mmsi, 'follow');
                }}
                onZoom={() => {
                  const lons = areaSel.ring.map((p) => p[0]);
                  const lats = areaSel.ring.map((p) => p[1]);
                  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats));
                  globe.current?.flyTo(
                    (Math.max(...lats) + Math.min(...lats)) / 2,
                    (Math.max(...lons) + Math.min(...lons)) / 2,
                    Math.max(20_000, span * 160_000),
                  );
                }}
              />
            ) : selectedAirport ? (
              <PlaceInspector
                place={{
                  kind: 'airport',
                  code: selectedAirport[0],
                  name: selectedAirport[1],
                  lon: selectedAirport[2],
                  lat: selectedAirport[3],
                }}
                faa={faa}
                onBack={clearSelection}
                onFly={() => globe.current?.flyTo(selectedAirport[3], selectedAirport[2], 20_000)}
              />
            ) : selectedPort ? (
              <PlaceInspector
                place={{
                  kind: selectedPort[5] ? 'seaport' : 'port',
                  code: selectedPort[0],
                  name: selectedPort[1],
                  country: selectedPort[2],
                  lon: selectedPort[3],
                  lat: selectedPort[4],
                }}
                onBack={clearSelection}
                onFly={() => globe.current?.flyTo(selectedPort[4], selectedPort[3], 20_000)}
              />
            ) : selectedBase ? (
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
                showRoute={showRoute}
                onShowRoute={(on) => {
                  setShowRoute(on);
                  void savePreferences({ show_route: on }).catch(() => undefined);
                }}
              />
            ) : selected ? (
              <EventInspector
                id={selected}
                onBack={() => setSelected(null)}
                onFly={(lat, lon) => globe.current?.flyTo(lat, lon)}
              />
            ) : toursOpen ? (
              <TourPanel
                tours={tours}
                shared={sharedTour}
                activeId={activeTour}
                playing={playing}
                onActive={setActiveTour}
                onTours={saveTours}
                onSaveShared={() => {
                  if (!sharedTour) return;
                  saveTours([...tours, sharedTour]);
                  setSharedTour(null);
                }}
                currentCamera={() => globe.current?.cameraString() ?? null}
                onGo={(s) => {
                  stopTour();
                  void globe.current?.flyCamera(s.camera, Math.min(s.fly_s, 3));
                }}
                onPlay={(t, from) => void playTour(t, from)}
                onStop={stopTour}
                onClose={() => setToursOpen(false)}
              />
            ) : sentinel ? (
              <ImageryPanel
                state={sentinel}
                onChange={(next) => setSentinel((s) => (s ? next(s) : s))}
                onClose={() => setSentinel(null)}
                onFly={() => {
                  const [w, s, e, n] = sentinel.box;
                  globe.current?.flyTo((s + n) / 2, (w + e) / 2, Math.max(15_000, (n - s) * 111_000 * 1.6));
                }}
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
                kpis={{
                  military: military.length,
                  tankers: military.filter((a) => a.role === 'Tanker').length,
                  vessels: seaOn ? vessels.length : null,
                  gps: gpsCells.filter((c) => c.level !== 'low').length,
                }}
                weatherNow={weatherNow}
                homeAlerts={homeAlerts}
              />
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
