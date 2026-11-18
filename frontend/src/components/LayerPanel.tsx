import type { EventType } from '../lib/api';
import { EVENT_TYPES, SEVERITY_NAME, TYPE_INFO } from '../lib/format';

export interface LayerFilters {
  types: Record<EventType, boolean>;
  minSeverity: number;
  candidates: boolean;
  hours: number;
}

export const DEFAULT_FILTERS: LayerFilters = {
  types: { conflict: true, unrest: true, quake: true, fire: true },
  minSeverity: 1,
  candidates: false,
  hours: 24,
};

interface Props {
  filters: LayerFilters;
  counts: Partial<Record<EventType, number>>;
  onChange: (f: LayerFilters) => void;
}

export default function LayerPanel({ filters, counts, onChange }: Props) {
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
