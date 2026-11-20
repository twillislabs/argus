import type { LayerFilters } from './LayerPanel';
import { SEVERITY_COLOR, SEVERITY_NAME } from '../lib/format';
import { AIR_COLOR } from '../map/aircraftLayer';
import { ADVISORY_COLOR } from '../map/advisoryLayer';
import { AIRSPACE_COLOR, STRUCTURE_COLOR } from '../map/airspaceLayer';
import { ALPR_COLOR } from '../map/alprLayer';
import { BASE_COLOR, FUEL_COLOR } from '../map/infraLayer';
import { SAT_COLOR } from '../map/satellites';
import { VESSEL_COLOR } from '../map/vesselLayer';
import { LAUNCH_COLOR } from '../map/launchLayer';
import { OUTAGE_COLOR, RANSOMWARE_COLOR } from '../map/cyberLayer';

interface Row {
  color: string;
  label: string;
  shape?: 'dot' | 'area' | 'line' | 'hex' | 'diamond';
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="lg-sec">
      <h4>{title}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.label}>
            <i className={'lg-' + (r.shape ?? 'dot')} style={{ ['--c' as string]: r.color }} />
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// What the colours on the map mean, for the layers that are on (as in
// Foundry Map's per-layer legends).
export default function Legend({ filters, onClose }: { filters: LayerFilters; onClose: () => void }) {
  const anyEvents = Object.values(filters.types).some(Boolean);
  const sea = Object.entries(filters.sea).filter(([, on]) => on);
  const space = Object.entries(filters.space).filter(([k, on]) => on && k !== 'launches');
  const airspace = (['tfr', 'sigmet', 'czib'] as const).filter((k) => filters.airspace[k]);
  return (
    <div className="legend-panel" role="dialog" aria-label="Legend">
      <div className="lg-head">
        <b>Legend</b>
        <button className="np-btn" aria-label="Close legend" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="lg-body">
        {anyEvents && (
          <Section
            title="Events · by severity"
            rows={[5, 4, 3, 2, 1].map((s) => ({ color: SEVERITY_COLOR[s], label: SEVERITY_NAME[s] }))}
          />
        )}
        {filters.tension && (
          <Section
            title="Country tension"
            rows={[
              { color: '#7a3a44', label: 'Moderate (55–67)', shape: 'area' },
              { color: '#a8434f', label: 'High tension (68–77)', shape: 'area' },
              { color: '#d84b59', label: 'Extreme (78+)', shape: 'area' },
            ]}
          />
        )}
        {(filters.air.military || filters.air.civil) && (
          <Section
            title="Aircraft"
            rows={[
              ...(filters.air.military ? [{ color: AIR_COLOR.military, label: 'Military' }] : []),
              ...(filters.air.civil ? [{ color: AIR_COLOR.civil, label: 'Civil' }] : []),
              { color: AIR_COLOR.emergency, label: 'Emergency squawk' },
            ]}
          />
        )}
        {(airspace.length > 0 || filters.airspace.gps) && (
          <Section
            title="Airspace"
            rows={[
              ...airspace.map((k) => ({
                color: AIRSPACE_COLOR[k],
                label: { tfr: 'Flight restriction', sigmet: 'SIGMET', czib: 'Conflict zone bulletin' }[k],
                shape: 'area' as const,
              })),
              ...(filters.airspace.gps
                ? [
                    {
                      color: AIRSPACE_COLOR.gps,
                      label: 'GPS interference (deeper = more aircraft affected)',
                      shape: 'hex' as const,
                    },
                  ]
                : []),
            ]}
          />
        )}
        {filters.airspace.raids && (
          <Section
            title="Air-raid alerts"
            rows={[
              { color: AIRSPACE_COLOR.raids, label: 'Sounding now (Ukraine oblasts, Israel localities)' },
              { color: '#8a3a44', label: 'Israel, last 24 h · Ukraine, continuous since 2022' },
            ]}
          />
        )}
        {filters.airspace.structure && (
          <Section
            title="Restricted areas, CTRs, TMAs"
            rows={Object.entries(STRUCTURE_COLOR)
              .filter(([, c], i, all) => all.findIndex(([, d]) => d === c) === i)
              .map(([label, color]) => ({ color, label, shape: 'area' as const }))}
          />
        )}
        {sea.length > 0 && (
          <Section
            title="Ships"
            rows={sea.map(([k]) => ({
              color: VESSEL_COLOR[k as keyof typeof VESSEL_COLOR],
              label: k[0].toUpperCase() + k.slice(1),
            }))}
          />
        )}
        {space.length > 0 && (
          <Section
            title="Satellites"
            rows={space.map(([k]) => ({
              color: k === 'starlink' ? '#9aa7ba' : SAT_COLOR[k as keyof typeof SAT_COLOR],
              label: k === 'starlink' ? 'Starlink' : k.toUpperCase(),
            }))}
          />
        )}
        {(filters.infra.outages || filters.infra.ransomware) && (
          <Section
            title="Cyber"
            rows={[
              ...(filters.infra.outages
                ? [
                    { color: OUTAGE_COLOR, label: 'Internet outage, ongoing (stronger) or in the last 24 h', shape: 'area' as const },
                  ]
                : []),
              ...(filters.infra.ransomware ? [{ color: RANSOMWARE_COLOR, label: 'Ransomware victims, latest claims (sized by count)' }] : []),
            ]}
          />
        )}
        {filters.space.launches && (
          <Section
            title="Rocket launches"
            rows={[
              { color: LAUNCH_COLOR.soon, label: 'Within 48 hours (ringed)' },
              { color: LAUNCH_COLOR.upcoming, label: 'Next two weeks' },
              { color: LAUNCH_COLOR.success, label: 'Launched, success' },
              { color: LAUNCH_COLOR.failure, label: 'Failure' },
            ]}
          />
        )}
        {filters.reference.advisories && (
          <Section
            title="Travel advisories"
            rows={[
              { color: ADVISORY_COLOR[2], label: 'Increased caution (US 2)', shape: 'area' },
              { color: ADVISORY_COLOR[3], label: 'Reconsider, or avoid parts (US 3)', shape: 'area' },
              { color: ADVISORY_COLOR[4], label: 'Do not travel (US 4)', shape: 'area' },
            ]}
          />
        )}
        {(filters.infra.nuclear ||
          filters.infra.power ||
          filters.infra.bases ||
          filters.infra.cables ||
          filters.infra.alpr) && (
          <Section
            title="Infrastructure"
            rows={[
              ...(filters.infra.nuclear || filters.infra.power
                ? Object.entries(FUEL_COLOR)
                    .filter(([k]) => filters.infra.power || k === 'Nuclear')
                    .map(([label, color]) => ({
                      color,
                      label: label + (label === 'Nuclear' ? '' : ' plant'),
                      shape: label === 'Nuclear' ? ('diamond' as const) : ('dot' as const),
                    }))
                : []),
              ...(filters.infra.bases ? [{ color: BASE_COLOR, label: 'Military base' }] : []),
              ...(filters.infra.cables ? [{ color: '#7fd1c7', label: 'Submarine cable', shape: 'line' as const }] : []),
              ...(filters.infra.alpr ? [{ color: ALPR_COLOR, label: 'Plate reader camera (wedge: facing)' }] : []),
            ]}
          />
        )}
        <p className="quiet small">Faded event markers are unconfirmed reports.</p>
      </div>
    </div>
  );
}
