import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { CivilStatus, EventType, SeaStatus, SourceStatus } from '../lib/api';
import { EVENT_TYPES, SEVERITY_NAME, TYPE_INFO } from '../lib/format';
import { AIR_COLOR } from '../map/aircraftLayer';
import { AIRSPACE_COLOR, type AirspaceFilters, DEFAULT_AIRSPACE } from '../map/airspaceLayer';
import { BASE_COLOR, DEFAULT_INFRA, FUEL_COLOR, type InfraFilters } from '../map/infraLayer';
import { DEFAULT_REFERENCE, type ReferenceLayers } from '../map/overlays';
import { DEFAULT_SPACE, SAT_COLOR, type SpaceFilters } from '../map/satellites';
import { TENSION_COLOR } from '../map/tensionLayer';
import { DEFAULT_SEA, type SeaFilters, VESSEL_COLOR } from '../map/vesselLayer';

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
}

export const DEFAULT_FILTERS: LayerFilters = {
  types: { conflict: true, unrest: true, quake: true, fire: true, hazard: true, maritime: false },
  minSeverity: 1,
  candidates: false,
  hours: 24,
  air: { military: true, civil: true, focus: '' },
  reference: DEFAULT_REFERENCE,
  space: DEFAULT_SPACE,
  sea: { ...DEFAULT_SEA, cargo: false, tanker: false, passenger: false, fishing: false, military: false },
  airspace: DEFAULT_AIRSPACE,
  infra: DEFAULT_INFRA,
  tension: true,
};

const INFRA_ROWS: { id: keyof InfraFilters; label: string; source: string; color: string }[] = [
  { id: 'nuclear', label: 'Nuclear plants', source: 'WRI power plant database', color: FUEL_COLOR.Nuclear },
  { id: 'power', label: 'Power plants (300 MW+)', source: 'Coal, gas, oil, hydro, renewables', color: FUEL_COLOR.Gas },
  { id: 'cables', label: 'Submarine cables', source: 'TeleGeography', color: '#7fd1c7' },
  { id: 'bases', label: 'Military bases', source: 'OpenStreetMap', color: BASE_COLOR },
];

const AIRSPACE_ROWS: { id: keyof AirspaceFilters; label: string; source: string }[] = [
  { id: 'tfr', label: 'Flight restrictions (TFRs)', source: 'FAA, United States' },
  { id: 'sigmet', label: 'SIGMETs', source: 'Storms, turbulence, icing, ash' },
  { id: 'czib', label: 'Conflict zone bulletins', source: 'EASA' },
  { id: 'gps', label: 'GPS interference', source: 'Argus, from ADS-B accuracy' },
  { id: 'structure', label: 'Restricted areas, CTRs, TMAs', source: 'openAIP · zoom in to load' },
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
  airCounts: { military: number; civil: number };
  civilStatus: CivilStatus;
  satCounts: Partial<Record<keyof SpaceFilters, number>>;
  seaCounts: Partial<Record<keyof SeaFilters, number>>;
  seaStatus: SeaStatus;
  airspaceCounts: Partial<Record<keyof AirspaceFilters, number>>;
  structureStatus: 'ok' | 'zoom' | 'nokey' | 'error';
  sources: SourceStatus[];
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
  hazard: ['gdacs', 'eonet', 'tsunami'],
  maritime: ['nga'],
  military: ['adsb_mil'],
  tfr: ['faa_tfr'],
  sigmet: ['sigmet'],
  czib: ['czib'],
  sea: ['aisstream'],
  space: ['celestrak'],
  cables: ['cables'],
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
  airCounts,
  civilStatus,
  satCounts,
  seaCounts,
  seaStatus,
  airspaceCounts,
  structureStatus,
  sources,
  onChange,
}: Props) {
  const seaOn = Object.values(filters.sea).some(Boolean);
  const air = filters.air;
  const setAir = (next: Partial<AirFilters>) => onChange({ ...filters, air: { ...air, ...next } });
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);
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
          onClick={() => onChange(DEFAULT_FILTERS)}
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
      <Group title="Events" on={countOn(filters.types) + (filters.tension ? 1 : 0)} total={EVENT_TYPES.length + 1} forceOpen={Boolean(q)}>
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
            <small>Argus index · against each country&apos;s normal</small>
          </span>
          <span className="lcount mono">{tensionCount ?? '–'}</span>
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
            <small className={civilStatus === 'error' || civilStatus === 'limited' ? 'warn' : undefined}>
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
              <small className={r.id === 'structure' && structureStatus === 'nokey' ? 'warn' : undefined}>
                {r.id === 'structure' && filters.airspace.structure
                  ? {
                      ok: 'openAIP · area in view',
                      zoom: 'openAIP · zoom in to load',
                      nokey: 'Needs an openAIP key (Settings)',
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
      <Group title="Sea" on={countOn(filters.sea)} total={SEA_ROWS.length} forceOpen={Boolean(q)}>
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
              <small>{r.source}</small>
            </span>
            <span className="lcount mono">
              {satCounts[r.id] ?? '–'}
              <Dot sources={sources} id="space" />
            </span>
          </label>
        ))}
      </Group>
      <Group title="Infrastructure" on={countOn(filters.infra)} total={INFRA_ROWS.length} forceOpen={Boolean(q)}>
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
              <Dot sources={sources} id={r.id} />
            </span>
          </label>
        ))}
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
