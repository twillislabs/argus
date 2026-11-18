import type { CivilStatus, EventType } from '../lib/api';
import { EVENT_TYPES, SEVERITY_NAME, TYPE_INFO } from '../lib/format';
import { AIR_COLOR } from '../map/aircraftLayer';

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
}

export const DEFAULT_FILTERS: LayerFilters = {
  types: { conflict: true, unrest: true, quake: true, fire: true },
  minSeverity: 1,
  candidates: false,
  hours: 24,
  air: { military: true, civil: true, focus: '' },
};

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
  airCounts: { military: number; civil: number };
  civilStatus: CivilStatus;
  onChange: (f: LayerFilters) => void;
}

const CIVIL_HINT: Record<CivilStatus, string> = {
  ok: 'adsb.lol · area in view',
  zoom: 'Zoom in to a region to load',
  off: 'adsb.lol · area in view',
  error: 'adsb.lol unavailable, retrying',
  limited: 'adsb.lol is busy; showing recent positions',
};

export default function LayerPanel({ filters, counts, airCounts, civilStatus, onChange }: Props) {
  const air = filters.air;
  const setAir = (next: Partial<AirFilters>) => onChange({ ...filters, air: { ...air, ...next } });
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);
  return (
    <aside className="side left" aria-label="Layers">
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
      <div className="group">
        <div className="gtitle">Events</div>
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
            <span className="lcount mono">{counts[t] ?? 0}</span>
          </label>
        ))}
      </div>
      <div className="group">
        <div className="gtitle">Air</div>
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
            <small>adsb.lol · worldwide</small>
          </span>
          <span className="lcount mono">{airCounts.military}</span>
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
      </div>
      <div className="group">
        <div className="gtitle">Filters</div>
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
      </div>
      <div className="group">
        <div className="gtitle">Severity</div>
        <ul className="legend">
          {[5, 4, 3, 2, 1].map((s) => (
            <li key={s}>
              <i className={'sev s' + s} />
              {SEVERITY_NAME[s]}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
