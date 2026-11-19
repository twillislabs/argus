import type { Aircraft, EventItem, Vessel } from '../lib/api';
import { TYPE_INFO } from '../lib/format';
import { aircraftColor } from '../map/aircraftLayer';
import { VESSEL_COLOR } from '../map/vesselLayer';
import { FeedItem } from './SituationPanel';

export interface AreaSelection {
  ring: [number, number][];
  events: EventItem[];
  aircraft: Aircraft[];
  vessels: Vessel[];
}

interface Props {
  sel: AreaSelection;
  onBack: () => void;
  onEvent: (id: string) => void;
  onAircraft: (hex: string) => void;
  onVessel: (mmsi: number) => void;
  onZoom: () => void;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv(sel: AreaSelection) {
  const rows: unknown[][] = [['kind', 'id', 'name', 'type', 'lat', 'lon', 'detail']];
  for (const e of sel.events) rows.push(['event', e.id, e.title, e.type, e.lat, e.lon, e.severity_name]);
  for (const a of sel.aircraft)
    rows.push(['aircraft', a.hex, a.callsign || a.reg, a.type, a.lat, a.lon, a.mil ? (a.role ?? 'military') : 'civil']);
  for (const v of sel.vessels) rows.push(['vessel', v.mmsi, v.name, v.category, v.lat, v.lon, v.flag ?? '']);
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'argus-selection-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Everything inside an area drawn with a Select tool: counts by kind, the
// items themselves, and actions on the set.
export default function SelectionPanel({ sel, onBack, onEvent, onAircraft, onVessel, onZoom }: Props) {
  const total = sel.events.length + sel.aircraft.length + sel.vessels.length;
  const byType = new Map<string, number>();
  for (const e of sel.events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">Selection · {total}</h1>
        <div className="tiles">
          <div className="tile">
            <small>Events</small>
            <span className="mono">{sel.events.length}</span>
          </div>
          <div className="tile">
            <small>Aircraft</small>
            <span className="mono">{sel.aircraft.length}</span>
          </div>
          <div className="tile">
            <small>Ships</small>
            <span className="mono">{sel.vessels.length}</span>
          </div>
          <div className="tile">
            <small>Military aircraft</small>
            <span className="mono">{sel.aircraft.filter((a) => a.mil).length}</span>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button className="btn small" onClick={onZoom}>
            Zoom to area
          </button>
          <button className="btn small" disabled={!total} onClick={() => exportCsv(sel)}>
            Export CSV
          </button>
        </div>
      </section>
      {sel.events.length > 0 && (
        <section className="isec">
          <h3>
            Events ·{' '}
            {[...byType.entries()].map(([t, n]) => TYPE_INFO[t as keyof typeof TYPE_INFO].label + ' ' + n).join(', ')}
          </h3>
          <ul className="feed">
            {[...sel.events]
              .sort((a, b) => b.severity - a.severity)
              .slice(0, 40)
              .map((e) => (
                <FeedItem key={e.id} e={e} onSelect={onEvent} />
              ))}
          </ul>
        </section>
      )}
      {sel.aircraft.length > 0 && (
        <section className="isec">
          <h3>Aircraft · {sel.aircraft.length}</h3>
          <ul className="contacts">
            {sel.aircraft.slice(0, 40).map((a) => (
              <li key={a.hex}>
                <button onClick={() => onAircraft(a.hex)}>
                  <i className="acdot" style={{ background: aircraftColor(a) }} />
                  <span className="cname">
                    <b className="mono">{a.callsign || a.reg || a.hex.toUpperCase()}</b>
                    <small>{[a.mil ? a.role : null, a.type].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="mono cmeta">{a.ground ? 'GND' : a.alt_ft !== null ? a.alt_ft + ' ft' : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sel.vessels.length > 0 && (
        <section className="isec">
          <h3>Ships · {sel.vessels.length}</h3>
          <ul className="contacts">
            {sel.vessels.slice(0, 40).map((v) => (
              <li key={v.mmsi}>
                <button onClick={() => onVessel(v.mmsi)}>
                  <i className="acdot" style={{ background: VESSEL_COLOR[v.category] }} />
                  <span className="cname">
                    <b>{v.name || 'MMSI ' + v.mmsi}</b>
                    <small>{[v.type, v.flag].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="mono cmeta">{v.sog !== null ? v.sog.toFixed(1) + ' kn' : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!total && <p className="quiet pad">Nothing on the map inside this area for the layers that are on.</p>}
    </div>
  );
}
