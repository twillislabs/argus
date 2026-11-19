import type { AirspaceItem } from '../lib/api';
import { zuluTime } from '../lib/format';
import { airspaceColor } from '../map/airspaceLayer';

const KIND_LABEL: Record<AirspaceItem['kind'], string> = {
  tfr: 'Temporary flight restriction',
  sigmet: 'SIGMET',
  czib: 'Conflict zone bulletin',
  structure: 'Airspace',
};

const SOURCE: Record<AirspaceItem['kind'], string> = {
  tfr: 'FAA (tfr.faa.gov). Check the NOTAM for exact times and levels.',
  sigmet: 'aviationweather.gov (NOAA).',
  czib: 'EASA. The bulletin has the full recommendations for operators.',
  structure: 'openAIP (CC BY-NC 4.0). Check official sources before flying.',
};

function level(ft: number | null): string {
  if (ft === null || ft === undefined) return '—';
  if (ft === 0) return 'Surface';
  return ft >= 18000 ? 'FL' + Math.round(ft / 100) : ft.toLocaleString() + ' ft';
}

function when(text: string | null): string {
  if (!text) return '—';
  return text.length > 10 ? zuluTime(text) : text;
}

export default function AirspaceInspector({
  item,
  onBack,
  onFly,
}: {
  item: AirspaceItem;
  onBack: () => void;
  onFly: () => void;
}) {
  const color = airspaceColor(item);
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: color }}>
            {KIND_LABEL[item.kind]}
          </span>
          {item.hazard && item.kind !== 'czib' && <span className="badge">{item.hazard}</span>}
          <span className="badge mono">{item.id}</span>
        </div>
        <h1 className="etitle">{item.title || item.id}</h1>
        <div className="sub">{item.area ?? item.facility ?? ''}</div>
        <div className="actions">
          <button className="btn" onClick={onFly}>
            Fly to
          </button>
          {item.url && (
            <a className="btn" href={item.url} target="_blank" rel="noopener noreferrer">
              Source ↗
            </a>
          )}
        </div>
      </section>
      <section className="isec">
        <dl className="kv">
          <div>
            <dt>{item.kind === 'czib' ? 'Issued' : 'From'}</dt>
            <dd>{when(item.valid_from)}</dd>
          </div>
          <div>
            <dt>Until</dt>
            <dd>{when(item.valid_to)}</dd>
          </div>
          {item.kind === 'structure' && (
            <>
              <div>
                <dt>Lower limit</dt>
                <dd>{item.lower ?? '—'}</dd>
              </div>
              <div>
                <dt>Upper limit</dt>
                <dd>{item.upper ?? '—'}</dd>
              </div>
            </>
          )}
          {item.kind === 'sigmet' && (
            <>
              <div>
                <dt>Base</dt>
                <dd>{level(item.base_ft)}</dd>
              </div>
              <div>
                <dt>Top</dt>
                <dd>{level(item.top_ft)}</dd>
              </div>
            </>
          )}
          {item.countries && item.countries.length > 0 && (
            <div className="wide">
              <dt>Countries</dt>
              <dd>{item.countries.join(', ')}</dd>
            </div>
          )}
        </dl>
      </section>
      {item.raw && (
        <section className="isec">
          <h3>Text</h3>
          <pre className="raw">{item.raw}</pre>
        </section>
      )}
      <section className="isec">
        <p className="quiet small">{SOURCE[item.kind]} Not for navigation.</p>
      </section>
    </div>
  );
}
