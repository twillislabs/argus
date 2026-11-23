import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { OUTAGE_COLOR, RANSOMWARE_COLOR } from '../map/cyberLayer';

import type { CivilStatus, EventType, FishingStatus, SeaStatus, SourceStatus } from '../lib/api';
import { EVENT_TYPES, SEVERITY_NAME, TYPE_INFO } from '../lib/format';
import { AIR_COLOR } from '../map/aircraftLayer';
import { AIRSPACE_COLOR, type AirspaceFilters, DEFAULT_AIRSPACE } from '../map/airspaceLayer';
import { BASE_COLOR, DEFAULT_INFRA, FUEL_COLOR, type InfraFilters } from '../map/infraLayer';
import { DEFAULT_REFERENCE, type ReferenceLayers } from '../map/overlays';
import { DEFAULT_SPACE, SAT_COLOR, type SpaceFilters } from '../map/satellites';
import { TENSION_COLOR } from '../map/tensionLayer';
import { WIKI_COLOR } from '../map/wikiLayer';
import { ALPR_COLOR } from '../map/alprLayer';
import { TRANSIT_COLOR } from '../map/transitLayer';
import { RADIO_COLOR } from '../map/radioLayer';
import { CAM_COLOR, WEBCAM_COLOR } from '../map/camLayer';
import { DEFAULT_WEATHER, opacityOf, type WeatherFilters, WX_IMAGERY, type WxImagery, type WxOpacity } from '../map/wxLayer';
import { distance } from '../lib/units';
import { DEFAULT_SEA, type SeaFilters, VESSEL_COLOR } from '../map/vesselLayer';
import { FISHING_COLOR } from '../map/fishingLayer';

export interface AirFilters {
  military: boolean;
  civil: boolean;
  // '' for every aircraft shown, 'emergency', or a military role.
  focus: string;
}

export interface LayerFilters {
  types: Record<EventType, boolean>;
  minSeverity: number;
  candidates: boolean;
  hours: number;
  air: AirFilters;
  reference: ReferenceLayers;
  space: SpaceFilters;
  sea: SeaFilters;
  airspace: AirspaceFilters;
  infra: InfraFilters;
  tension: boolean;
  // Wikipedia current events (map/wikiLayer.ts).
  wiki: boolean;
  // Cameras: government traffic cameras (map/camLayer.ts).
  cams: { traffic: boolean; webcams: boolean };
  weather: WeatherFilters;
}

export const DEFAULT_FILTERS: LayerFilters = {
  types: { conflict: true, unrest: true, incident: true, quake: true, fire: true, hazard: true, maritime: false },
  minSeverity: 1,
  candidates: false,
  hours: 24,
  // Military aircraft are polled by the worker anyway, so showing them
  // costs nothing; civil traffic is fetched per view from the shared
  // ADS-B quota, so it starts off.
  air: { military: true, civil: false, focus: '' },
  reference: DEFAULT_REFERENCE,
  space: DEFAULT_SPACE,
  sea: { ...DEFAULT_SEA, cargo: false, tanker: false, passenger: false, fishing: false, military: false },
  airspace: DEFAULT_AIRSPACE,
  infra: DEFAULT_INFRA,
  tension: true,
  wiki: false,
  cams: { traffic: false, webcams: false },
  weather: DEFAULT_WEATHER,
};

// The built-in defaults with an admin's server-wide defaults over them
// (Settings > Defaults): what the map opens with and Reset returns to.
export function serverFilters(layers: Record<string, unknown> | undefined): LayerFilters {
  const d = (layers ?? {}) as Partial<Record<keyof LayerFilters, unknown>>;
  const part = <T extends object>(base: T, v: unknown): T => ({ ...base, ...((v as Partial<T>) ?? {}) });
  return {
    ...DEFAULT_FILTERS,
    types: part(DEFAULT_FILTERS.types, d.types),
    air: part(DEFAULT_FILTERS.air, d.air),
    reference: part(DEFAULT_FILTERS.reference, d.reference),
    space: part(DEFAULT_FILTERS.space, d.space),
    sea: part(DEFAULT_FILTERS.sea, d.sea),
    airspace: part(DEFAULT_FILTERS.airspace, d.airspace),
    infra: part(DEFAULT_FILTERS.infra, d.infra),
    weather: part(DEFAULT_FILTERS.weather, d.weather),
    tension: typeof d.tension === 'boolean' ? d.tension : DEFAULT_FILTERS.tension,
    wiki: typeof d.wiki === 'boolean' ? d.wiki : DEFAULT_FILTERS.wiki,
    cams: part(DEFAULT_FILTERS.cams, d.cams),
    hours: typeof d.hours === 'number' ? d.hours : DEFAULT_FILTERS.hours,
    minSeverity: typeof d.minSeverity === 'number' ? d.minSeverity : DEFAULT_FILTERS.minSeverity,
    candidates: typeof d.candidates === 'boolean' ? d.candidates : DEFAULT_FILTERS.candidates,
  };
}

const WEATHER_ROWS: { id: keyof WeatherFilters; label: string; source: string; color: string }[] = [
  { id: 'alerts', label: 'Storm warnings', source: 'NWS · tornado, thunderstorm, flood', color: '#ff2d3d' },
  { id: 'zones', label: 'Watches and advisories', source: 'NWS · by forecast zone and county', color: '#e3c04b' },
  { id: 'outlook', label: 'Severe weather outlook', source: 'SPC · today, level 1–5', color: '#66a366' },
  { id: 'storms', label: 'Tropical storms', source: 'GDACS · track, forecast cone, wind swath', color: '#ff9447' },
  { id: 'fires', label: 'Wildfire outlines (US)', source: 'NIFC · mapped fire perimeters', color: '#ff6a2b' },
  { id: 'radar', label: 'Radar (US)', source: 'NOAA nowCOAST · MRMS mosaic, 5 min', color: '#36d1a0' },
  { id: 'lightning', label: 'Lightning', source: 'NOAA nowCOAST · strike density', color: '#ffe066' },
  { id: 'clouds', label: 'Clouds (infrared)', source: 'NASA GIBS · GOES, Himawari', color: '#9aa7ba' },
  { id: 'vapour', label: 'Water vapour', source: 'NOAA nowCOAST · global satellites', color: '#8f7bff' },
  { id: 'precip', label: 'Precipitation', source: 'NASA GIBS · IMERG, a few hours behind', color: '#3fa7ff' },
  { id: 'sst', label: 'Sea temperature', source: 'NOAA nowCOAST · daily analysis', color: '#ff6b6b' },
  { id: 'wind', label: 'Wind (animated)', source: 'NOAA GFS · 10 m, every 3 hours', color: '#7ee0c2' },
  { id: 'air', label: 'Air quality', source: 'Open-Meteo · CAMS, US AQI, hourly', color: '#4cc96b' },
  { id: 'loop', label: 'Loop the last hour', source: 'Radar and clouds move · 10-minute frames', color: '#5b9bff' },
];

const INFRA_ROWS: { id: keyof InfraFilters; label: string; source: string; color: string }[] = [
  { id: 'nuclear', label: 'Nuclear plants', source: 'WRI power plant database', color: FUEL_COLOR.Nuclear },
  { id: 'power', label: 'Power plants (300 MW+)', source: 'Coal, gas, oil, hydro, renewables', color: FUEL_COLOR.Gas },
  { id: 'cables', label: 'Submarine cables', source: 'TeleGeography', color: '#7fd1c7' },
  { id: 'bases', label: 'Military bases', source: 'OpenStreetMap', color: BASE_COLOR },
  { id: 'alpr', label: 'Plate reader cameras', source: 'Flock and other ALPR · OpenStreetMap', color: ALPR_COLOR },
  { id: 'transit', label: 'Public transport (live)', source: 'Operators’ GTFS-Realtime · 9 cities', color: TRANSIT_COLOR },
  { id: 'radio', label: 'Radio stations', source: 'Radio Browser · most played stations', color: RADIO_COLOR },
  { id: 'outages', label: 'Internet outages', source: 'IODA · countries, last 24 hours', color: OUTAGE_COLOR },
  { id: 'ransomware', label: 'Ransomware victims', source: 'ransomware.live · latest 100 claims, per country', color: RANSOMWARE_COLOR },
];

const AIRSPACE_ROWS: { id: keyof AirspaceFilters; label: string; source: string }[] = [
  { id: 'tfr', label: 'Flight restrictions (TFRs)', source: 'FAA, United States' },
  { id: 'sigmet', label: 'SIGMETs', source: 'Storms, turbulence, icing, ash' },
  { id: 'czib', label: 'Conflict zone bulletins', source: 'EASA' },
  { id: 'gps', label: 'GPS interference', source: 'Argus, from ADS-B accuracy' },
  { id: 'structure', label: 'Restricted areas, CTRs, TMAs', source: 'openAIP · zoom in to load' },
  { id: 'raids', label: 'Air-raid alerts', source: 'Ukraine by oblast · Israel by locality, 24 h' },
];

const SEA_ROWS: { id: keyof SeaFilters; label: string }[] = [
  { id: 'military', label: 'Military and law enforcement' },
  { id: 'tanker', label: 'Tankers' },
  { id: 'cargo', label: 'Cargo' },
  { id: 'passenger', label: 'Passenger' },
  { id: 'fishing', label: 'Fishing' },
  { id: 'other', label: 'Other (tugs, pleasure, unknown)' },
];

const SEA_HINT: Record<SeaStatus, string> = {
  ok: 'AISStream · area in view',
  nokey: 'Needs an AISStream key (Settings)',
  waiting: 'Connecting to AISStream…',
};

const SPACE_ROWS: { id: keyof SpaceFilters; label: string; source: string; color: string }[] = [
  { id: 'iss', label: 'Space stations', source: 'ISS (3D model) and Tiangong', color: SAT_COLOR.station },
  { id: 'launches', label: 'Rocket launches', source: 'Launch Library 2 · last 3 days, next 2 weeks', color: '#ffd166' },
  { id: 'leo', label: 'Low Earth orbit', source: 'Under 2,000 km · stations, imaging', color: SAT_COLOR.leo },
  { id: 'meo', label: 'Medium Earth orbit', source: 'GPS, Galileo, GLONASS, BeiDou', color: SAT_COLOR.meo },
  { id: 'geo', label: 'Geosynchronous', source: 'Communications, weather', color: SAT_COLOR.geo },
  { id: 'heo', label: 'Highly elliptical', source: 'Molniya, Tundra and similar', color: SAT_COLOR.heo },
  { id: 'starlink', label: 'Starlink', source: 'About 11,000 satellites', color: '#9aa7ba' },
];

const REFERENCE_ROWS: { id: keyof ReferenceLayers; label: string; source: string }[] = [
  { id: 'borders', label: 'Country borders', source: 'Natural Earth 50m' },
  { id: 'states', label: 'State / province borders', source: 'Natural Earth 10m' },
  { id: 'labels', label: 'Place labels', source: 'Argus · countries, cities of 200k+' },
  { id: 'basemapLabels', label: 'Basemap labels', source: 'Names and roads in the map tiles' },
  { id: 'airports', label: 'Airports', source: 'OurAirports, large airports' },
  { id: 'ports', label: 'Ports', source: 'UN/LOCODE, sea and inland' },
  { id: 'advisories', label: 'Travel advisories', source: 'US State Dept · UK FCDO' },
];

export const AIR_FOCUS = [
  ['', 'All shown aircraft'],
  ['emergency', 'Emergencies (7500/7600/7700)'],
  ['Tanker', 'Tankers'],
  ['ISR', 'ISR and surveillance'],
  ['AEW&C', 'Airborne early warning'],
  ['Patrol', 'Maritime patrol'],
  ['Airlift', 'Airlift'],
  ['Bomber', 'Bombers'],
  ['Fighter', 'Fighters'],
  ['Helicopter', 'Helicopters'],
  ['VIP', 'VIP transport'],
] as const;

interface Props {
  filters: LayerFilters;
  counts: Partial<Record<EventType, number>>;
  // Countries tinted (above their normal level).
  tensionCount?: number;
  wikiCount?: number;
  // Cameras in view, or undefined while the view is too wide.
  alprCount?: number;
  alprLoading?: boolean;
  transitCount?: string;
  radioCount?: number;
  camCount?: number;
  webcamCount?: number;
  // "zoom in", "no key" and so on, while there's no count.
  webcamNote?: string;
  advisoryCount?: number;
  // Storm warnings and zone alerts drawn on the map.
  weatherCount?: number;
  zoneCount?: number;
  stormCount?: number;
  // Global Fishing Watch (a Sea row, stored in infra.fishing).
  fishingStatus?: FishingStatus;
  fishingCount?: number;
  fireCount?: number;
  airCount?: string;
  // Weather imagery opacity, by layer.
  weatherOpacity?: WxOpacity;
  onWeatherOpacity?: (o: WxOpacity) => void;
  airCounts: { military: number; civil: number };
  civilStatus: CivilStatus;
  satCounts: Partial<Record<keyof SpaceFilters, number>>;
  seaCounts: Partial<Record<keyof SeaFilters, number>>;
  seaStatus: SeaStatus;
  airspaceCounts: Partial<Record<keyof AirspaceFilters, number>>;
  structureStatus: 'ok' | 'zoom' | 'nokey' | 'blocked' | 'error';
  sources: SourceStatus[];
  // What Reset filters returns to (built-in plus server defaults).
  resetTo: LayerFilters;
  onChange: (f: LayerFilters) => void;
}

const CIVIL_HINT: Record<CivilStatus, string> = {
  ok: 'adsb.lol / adsb.fi · area in view',
  zoom: 'Zoom in to a region to load',
  off: 'adsb.lol / adsb.fi · area in view',
  error: 'ADS-B feeds unavailable, retrying',
  limited: 'ADS-B feeds are busy; showing recent positions',
};

// Which collectors feed each layer, for the health dot beside its count.
const FEEDS: Record<string, string[]> = {
  conflict: ['gdelt'],
  unrest: ['gdelt'],
  quake: ['usgs'],
  fire: ['firms'],
  hazard: ['gdacs', 'eonet', 'tsunami', 'nws', 'fema', 'nifc'],
  incident: ['gdelt', 'rss'],
  maritime: ['nga'],
  military: ['adsb_mil'],
  tfr: ['faa_tfr'],
  sigmet: ['sigmet'],
  czib: ['czib'],
  sea: ['aisstream'],
  space: ['celestrak'],
  cables: ['cables'],
  'wx-alerts': ['nws'],
  'wx-zones': ['nws'],
  'wx-outlook': ['spc'],
  advisories: ['advisories'],
  wikipedia: ['wikipedia'],
  trafficcams: ['trafficcams'],
};

function health(sources: SourceStatus[], id: string): { cls: string; title: string } | null {
  const names = FEEDS[id];
  if (!names || !sources.length) return null;
  const mine = sources.filter((s) => names.includes(s.name));
  if (!mine.length || mine.every((s) => !s.enabled)) return { cls: 'off', title: 'Not collecting' };
  const now = Date.now();
  const late = mine.filter((s) => {
    if (!s.enabled) return false;
    const ok = s.last_success_at ? Date.parse(s.last_success_at) : 0;
    return s.last_error || now - ok > Math.max(3 * s.interval_s, 900) * 1000;
  });
  if (!late.length) return { cls: '', title: 'Source healthy' };
  return { cls: 'warn', title: late.map((s) => s.label + ': ' + (s.last_error ?? 'no recent data')).join('\n') };
}

function Dot({ sources, id }: { sources: SourceStatus[]; id: string }) {
  const h = health(sources, id);
  return h ? <i className={'sdot ' + h.cls} title={h.title} /> : null;
}

const OPEN_KEY = 'argus-layer-groups';
function loadClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

// A collapsible layer group with "on / total" in its title, as in the
// mock-up. Collapsed groups are remembered in this browser.
function Group({
  title,
  on,
  total,
  forceOpen,
  children,
}: {
  title: string;
  on?: number;
  total?: number;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !loadClosed().includes(title));
  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    const next = !open;
    setOpen(next);
    try {
      const closed = new Set(loadClosed());
      if (next) closed.delete(title);
      else closed.add(title);
      localStorage.setItem(OPEN_KEY, JSON.stringify([...closed]));
    } catch {
      // Storage blocked: the group just opens next time.
    }
  }
  return (
    <details className="lgroup" open={open || forceOpen}>
      <summary onClick={toggle}>
        {title}
        {total !== undefined && (
          <span className="mono">
            {on}/{total}
          </span>
        )}
      </summary>
      {children}
    </details>
  );
}

const countOn = (o: object) => Object.values(o).filter((v) => v === true).length;

export default function LayerPanel({
  filters,
  counts,
  tensionCount,
  wikiCount,
  alprCount,
  alprLoading,
  transitCount,
  radioCount,
  camCount,
  webcamCount,
  webcamNote,
  advisoryCount,
  weatherCount,
  zoneCount,
  stormCount,
  fishingStatus = 'zoom',
  fishingCount,
  fireCount,
  airCount,
  weatherOpacity,
  onWeatherOpacity,
  airCounts,
  civilStatus,
  satCounts,
  seaCounts,
  seaStatus,
  airspaceCounts,
  structureStatus,
  sources,
  resetTo,
  onChange,
}: Props) {
  const seaOn = Object.values(filters.sea).some(Boolean);
  const air = filters.air;
  const setAir = (next: Partial<AirFilters>) => onChange({ ...filters, air: { ...air, ...next } });
  const isDefault = JSON.stringify(filters) === JSON.stringify(resetTo);
  const [q, setQ] = useState('');
  const panel = useRef<HTMLElement>(null);
  // Filter rows by their text; groups with nothing left are hidden.
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const needle = q.trim().toLowerCase();
    for (const g of root.querySelectorAll<HTMLElement>('.lgroup')) {
      let any = false;
      for (const row of g.querySelectorAll<HTMLElement>('.lrow')) {
        const hit = !needle || (row.textContent ?? '').toLowerCase().includes(needle);
        row.hidden = !hit;
        any ||= hit;
      }
      g.hidden = Boolean(needle) && !any;
    }
  });
  return (
    <aside ref={panel} className="side left" aria-label="Layers">
      <div className="ph">
        <h2>Layers</h2>
        <button
          className="btn small"
          disabled={isDefault}
          onClick={() => onChange(resetTo)}
        >
          Reset filters
        </button>
      </div>
      <div className="lfilter">
        <input
          type="search"
          value={q}
          placeholder="Filter layers"
          aria-label="Filter layers"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Group
        title="Events"
        on={countOn(filters.types) + (filters.tension ? 1 : 0) + (filters.wiki ? 1 : 0)}
        total={EVENT_TYPES.length + 2}
        forceOpen={Boolean(q)}
      >
        {EVENT_TYPES.map((t) => (
          <label key={t} className="lrow">
            <input
              type="checkbox"
              checked={filters.types[t]}
              onChange={(e) =>
                onChange({ ...filters, types: { ...filters.types, [t]: e.target.checked } })
              }
            />
            <span className="tog" />
            <span className="sw" style={{ background: TYPE_INFO[t].color }} />
            <span className="lname">
              <span>{TYPE_INFO[t].label}</span>
              <small>{TYPE_INFO[t].source}</small>
            </span>
            <span className="lcount mono">
              {counts[t] ?? 0}
              <Dot sources={sources} id={t} />
            </span>
          </label>
        ))}
        <label className="lrow">
          <input
            type="checkbox"
            checked={filters.tension}
            onChange={(e) => onChange({ ...filters, tension: e.target.checked })}
          />
          <span className="tog" />
          <span className="sw area" style={{ background: TENSION_COLOR }} />
          <span className="lname">
            <span>Country tension</span>
            <small>UCDP violence + live events</small>
          </span>
          <span className="lcount mono">{tensionCount ?? '–'}</span>
        </label>
        <label className="lrow">
          <input type="checkbox" checked={filters.wiki} onChange={(e) => onChange({ ...filters, wiki: e.target.checked })} />
          <span className="tog" />
          <span className="sw" style={{ background: WIKI_COLOR }} />
          <span className="lname">
            <span>Wikipedia events</span>
            <small>Portal:Current events, last 3 days</small>
          </span>
          <span className="lcount mono">
            {wikiCount ?? '–'}
            <Dot sources={sources} id="wikipedia" />
          </span>
        </label>
      </Group>
      <Group title="Air" on={countOn({ m: air.military, c: air.civil })} total={2} forceOpen={Boolean(q)}>
        <label className="lrow">
          <input
            type="checkbox"
            checked={air.military}
            onChange={(e) => setAir({ military: e.target.checked })}
          />
          <span className="tog" />
          <span className="sw plane" style={{ background: AIR_COLOR.military }} />
          <span className="lname">
            <span>Military aircraft</span>
            <small>adsb.fi / adsb.lol · worldwide</small>
          </span>
          <span className="lcount mono">
            {airCounts.military}
            <Dot sources={sources} id="military" />
          </span>
        </label>
        <label className="lrow">
          <input
            type="checkbox"
            checked={air.civil}
            onChange={(e) => setAir({ civil: e.target.checked })}
          />
          <span className="tog" />
          <span className="sw plane" style={{ background: AIR_COLOR.civil }} />
          <span className="lname">
            <span>Civil aircraft</span>
            <small className={air.civil && (civilStatus === 'error' || civilStatus === 'limited') ? 'warn' : undefined}>
              {CIVIL_HINT[air.civil ? civilStatus : 'off']}
            </small>
          </span>
          <span className="lcount mono">{air.civil && (civilStatus === 'ok' || civilStatus === 'limited') ? airCounts.civil : '–'}</span>
        </label>
        <div className="field pad">
          <label htmlFor="f-air">Show</label>
          <select id="f-air" value={air.focus} onChange={(e) => setAir({ focus: e.target.value })}>
            {AIR_FOCUS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </Group>
      <Group title="Airspace" on={countOn(filters.airspace)} total={AIRSPACE_ROWS.length} forceOpen={Boolean(q)}>
        {AIRSPACE_ROWS.map((r) => (
          <label key={r.id} className="lrow">
            <input
              type="checkbox"
              checked={filters.airspace[r.id]}
              onChange={(e) => onChange({ ...filters, airspace: { ...filters.airspace, [r.id]: e.target.checked } })}
            />
            <span className="tog" />
            <span className="sw area" style={{ borderColor: AIRSPACE_COLOR[r.id] }} />
            <span className="lname">
              <span>{r.label}</span>
              <small
                className={
                  r.id === 'structure' && filters.airspace.structure && structureStatus !== 'ok' && structureStatus !== 'zoom'
                    ? 'warn'
                    : undefined
                }
              >
                {r.id === 'structure' && filters.airspace.structure
                  ? {
                      ok: 'openAIP · area in view',
                      zoom: 'openAIP · zoom in to load',
                      nokey: 'Needs an openAIP key (Settings)',
                      blocked: 'openAIP is refusing this server (403)',
                      error: 'openAIP unavailable',
                    }[structureStatus]
                  : r.source}
              </small>
            </span>
            <span className="lcount mono">
              {airspaceCounts[r.id] ?? '–'}
              <Dot sources={sources} id={r.id} />
            </span>
          </label>
        ))}
      </Group>
      <Group
        title="Sea"
        on={countOn({ ...filters.sea, gfw: filters.infra.fishing })}
        total={SEA_ROWS.length + 1}
        forceOpen={Boolean(q)}
      >
        {seaOn && <p className={'ghint' + (seaStatus === 'ok' ? '' : ' warn')}>{SEA_HINT[seaStatus]}</p>}
        {SEA_ROWS.map((r) => (
          <label key={r.id} className="lrow">
            <input
              type="checkbox"
              checked={filters.sea[r.id]}
              onChange={(e) => onChange({ ...filters, sea: { ...filters.sea, [r.id]: e.target.checked } })}
            />
            <span className="tog" />
            <span className="sw hull" style={{ background: VESSEL_COLOR[r.id] }} />
            <span className="lname">
              <span>{r.label}</span>
            </span>
            <span className="lcount mono">
              {seaOn && seaStatus === 'ok' ? (seaCounts[r.id] ?? 0) : '–'}
              {seaOn && <Dot sources={sources} id="sea" />}
            </span>
          </label>
        ))}
        <label className="lrow">
          <input
            type="checkbox"
            checked={filters.infra.fishing}
            onChange={(e) => onChange({ ...filters, infra: { ...filters.infra, fishing: e.target.checked } })}
          />
          <span className="tog" />
          <span className="sw" style={{ background: FISHING_COLOR.encounter }} />
          <span className="lname">
            <span>Ships meeting, loitering, going dark</span>
            <small
              className={
                filters.infra.fishing && fishingStatus !== 'ok' && fishingStatus !== 'zoom' ? 'warn' : undefined
              }
            >
              {filters.infra.fishing
                ? {
                    ok: 'Global Fishing Watch · last 30 days',
                    zoom: 'Global Fishing Watch · zoom in to load',
                    nokey: 'Needs a Global Fishing Watch key (Settings)',
                    refused: 'Global Fishing Watch refused the key',
                    error: 'Global Fishing Watch unavailable',
                  }[fishingStatus]
                : 'Global Fishing Watch · last 30 days'}
            </small>
          </span>
          <span className="lcount mono">{fishingCount ?? '–'}</span>
        </label>
      </Group>
      <Group title="Space" on={countOn(filters.space)} total={SPACE_ROWS.length} forceOpen={Boolean(q)}>
        {SPACE_ROWS.map((r) => (
          <label key={r.id} className="lrow">
            <input
              type="checkbox"
              checked={filters.space[r.id]}
              onChange={(e) => onChange({ ...filters, space: { ...filters.space, [r.id]: e.target.checked } })}
            />
            <span className="tog" />
            <span className="sw sat" style={{ background: r.color }} />
            <span className="lname">
              <span>{r.label}</span>
              <small>{r.id === 'leo' ? 'Under ' + distance(2000) + ' · stations, imaging' : r.source}</small>
            </span>
            <span className="lcount mono">
              {satCounts[r.id] ?? '–'}
              <Dot sources={sources} id="space" />
            </span>
          </label>
        ))}
      </Group>
      <Group title="Weather" on={countOn(filters.weather)} total={WEATHER_ROWS.length} forceOpen={Boolean(q)}>
        {WEATHER_ROWS.map((r) => {
          const img = (WX_IMAGERY as string[]).includes(r.id) ? (r.id as WxImagery) : null;
          return (
            <Fragment key={r.id}>
              <label className="lrow">
                <input
                  type="checkbox"
                  checked={filters.weather[r.id]}
                  onChange={(e) => onChange({ ...filters, weather: { ...filters.weather, [r.id]: e.target.checked } })}
                />
                <span className="tog" />
                <span className={'sw' + (img ? '' : ' area')} style={{ background: r.color, borderColor: r.color }} />
                <span className="lname">
                  <span>{r.label}</span>
                  <small>{r.source}</small>
                </span>
                <span className="lcount mono">
                  {r.id === 'alerts'
                    ? (weatherCount ?? '–')
                    : r.id === 'zones'
                      ? (zoneCount ?? '–')
                      : r.id === 'storms'
                        ? (stormCount ?? '–')
                        : r.id === 'fires'
                        ? (fireCount ?? '–')
                        : r.id === 'air'
                          ? (airCount ?? '')
                          : ''}
                  <Dot sources={sources} id={'wx-' + r.id} />
                </span>
              </label>
              {img && filters.weather[img] && onWeatherOpacity && (
                <label className="lopacity">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    aria-label={r.label + ' opacity'}
                    value={Math.round(opacityOf(weatherOpacity, img) * 100)}
                    onChange={(e) => onWeatherOpacity({ ...weatherOpacity, [img]: Number(e.target.value) / 100 })}
                  />
                  <span className="mono">{Math.round(opacityOf(weatherOpacity, img) * 100)}%</span>
                </label>
              )}
            </Fragment>
          );
        })}
      </Group>
      <Group title="Infrastructure" on={countOn({ ...filters.infra, fishing: false })} total={INFRA_ROWS.length} forceOpen={Boolean(q)}>
        {INFRA_ROWS.map((r) => (
          <label key={r.id} className="lrow">
            <input
              type="checkbox"
              checked={filters.infra[r.id]}
              onChange={(e) => onChange({ ...filters, infra: { ...filters.infra, [r.id]: e.target.checked } })}
            />
            <span className="tog" />
            <span className="sw" style={{ background: r.color }} />
            <span className="lname">
              <span>{r.label}</span>
              <small>{r.source}</small>
            </span>
            <span className="lcount mono">
              {r.id === 'alpr' && filters.infra.alpr
                ? alprLoading
                  ? (alprCount ? alprCount + '…' : 'loading…')
                  : (alprCount ?? 'zoom in')
                : r.id === 'transit' && filters.infra.transit
                  ? (transitCount ?? '–')
                  : r.id === 'radio' && filters.infra.radio
                    ? (radioCount ?? '–')
                    : null}
              <Dot sources={sources} id={r.id} />
            </span>
          </label>
        ))}
      </Group>
      <Group title="Cameras" on={countOn(filters.cams)} total={2} forceOpen={Boolean(q)}>
        <label className="lrow">
          <input
            type="checkbox"
            checked={filters.cams.traffic}
            onChange={(e) => onChange({ ...filters, cams: { ...filters.cams, traffic: e.target.checked } })}
          />
          <span className="tog" />
          <span className="sw" style={{ background: CAM_COLOR }} />
          <span className="lname">
            <span>Traffic cameras</span>
            <small>Government traffic cameras · US, Canada, Europe, Hong Kong</small>
          </span>
          <span className="lcount mono">
            {filters.cams.traffic ? (camCount ?? 'zoom in') : null}
            <Dot sources={sources} id="trafficcams" />
          </span>
        </label>
        <label className="lrow">
          <input
            type="checkbox"
            checked={filters.cams.webcams}
            onChange={(e) => onChange({ ...filters, cams: { ...filters.cams, webcams: e.target.checked } })}
          />
          <span className="tog" />
          <span className="sw" style={{ background: WEBCAM_COLOR }} />
          <span className="lname">
            <span>Webcams</span>
            <small className={filters.cams.webcams && webcamNote === 'no key' ? 'warn' : undefined}>
              {filters.cams.webcams && webcamNote === 'no key'
                ? 'Needs a Windy key (Settings)'
                : 'Windy · webcams near the view'}
            </small>
          </span>
          <span className="lcount mono">{filters.cams.webcams ? (webcamCount ?? webcamNote ?? '–') : null}</span>
        </label>
      </Group>
      <Group title="Reference" on={countOn(filters.reference)} total={REFERENCE_ROWS.length} forceOpen={Boolean(q)}>
        {REFERENCE_ROWS.map((r) => (
          <label key={r.id} className="lrow">
            <input
              type="checkbox"
              checked={filters.reference[r.id]}
              onChange={(e) =>
                onChange({ ...filters, reference: { ...filters.reference, [r.id]: e.target.checked } })
              }
            />
            <span className="tog" />
            <span className={'sw ref ' + r.id} />
            <span className="lname">
              <span>{r.label}</span>
              <small>{r.source}</small>
            </span>
            {r.id === 'advisories' && (
              <span className="lcount mono">
                {advisoryCount ?? '–'}
                <Dot sources={sources} id="advisories" />
              </span>
            )}
          </label>
        ))}
      </Group>
      <Group title="Filters" forceOpen={Boolean(q)}>
        <div className="field pad">
          <label htmlFor="f-sev">Minimum severity</label>
          <select
            id="f-sev"
            value={filters.minSeverity}
            onChange={(e) => onChange({ ...filters, minSeverity: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={s}>
                {SEVERITY_NAME[s]} and above
              </option>
            ))}
          </select>
        </div>
        <div className="field pad">
          <label htmlFor="f-hours">Time window</label>
          <select
            id="f-hours"
            value={filters.hours}
            onChange={(e) => onChange({ ...filters, hours: Number(e.target.value) })}
          >
            {[6, 24, 72, 168].map((h) => (
              <option key={h} value={h}>
                Last {h < 48 ? h + ' hours' : h / 24 + ' days'}
              </option>
            ))}
          </select>
        </div>
        <label className="lrow">
          <input
            type="checkbox"
            checked={filters.candidates}
            onChange={(e) => onChange({ ...filters, candidates: e.target.checked })}
          />
          <span className="tog" />
          <span className="sw hollow" />
          <span className="lname">
            <span>Unconfirmed reports</span>
            <small>GDELT, single outlet</small>
          </span>
        </label>
      </Group>
      <Group title="Severity" forceOpen={Boolean(q)}>
        <ul className="legend">
          {[5, 4, 3, 2, 1].map((s) => (
            <li key={s}>
              <i className={'sev s' + s} />
              {SEVERITY_NAME[s]}
            </li>
          ))}
        </ul>
      </Group>
    </aside>
  );
}
