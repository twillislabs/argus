import { useMemo } from 'react';

import type { AlprCamera } from '../lib/api';
import { ALPR_COLOR } from '../map/alprLayer';

// One plate reader as volunteers mapped it in OpenStreetMap (the DeFlock
// dataset): who runs it, what it is, which way it looks, when it was
// mapped, every tag, and a summary of the cameras in view. Locations
// only: there's no public plate data and Argus never looks for any.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (d: number) => COMPASS[Math.round(d / 45) % 8];

const OPERATOR_TYPE: Record<string, string> = {
  government: 'Government',
  public: 'Public body',
  private: 'Private',
  community: 'Community / HOA',
  business: 'Business',
};

function top(list: string[], n = 5): [string, number][] {
  const counts = new Map<string, number>();
  for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export default function AlprInspector({
  cam,
  inView,
  onBack,
}: {
  cam: AlprCamera;
  inView: AlprCamera[];
  onBack: () => void;
}) {
  const t = cam.tags ?? {};
  const rows: [string, string | null | undefined][] = [
    ['Operator', cam.operator],
    ['Operator type', cam.operator_type ? (OPERATOR_TYPE[cam.operator_type] ?? cam.operator_type) : null],
    ['Vendor', cam.vendor],
    ['Model', cam.model],
    [
      'Faces',
      cam.directions?.length ? cam.directions.map((d) => compass(d) + ' (' + Math.round(d) + '°)').join(', ') : null,
    ],
    ['Mount', cam.mount],
    ['Zone', cam.zone],
    ['Height', t.height ? t.height + ' m' : null],
    ['Installed', t.start_date],
    ['Last checked', t.check_date || t['survey:date']],
    ['Note', t.note || t.description],
  ];
  const operators = useMemo(() => top(inView.map((c) => c.operator || 'Operator not mapped')), [inView]);
  const vendors = useMemo(() => top(inView.map((c) => c.vendor)), [inView]);
  const flock = /flock/i.test(cam.vendor);
  const portal =
    flock && cam.operator
      ? 'https://duckduckgo.com/?q=' + encodeURIComponent('site:transparency.flocksafety.com "' + cam.operator + '"')
      : null;

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">
          <span className="acdot" style={{ background: ALPR_COLOR }} />
          Plate reader · {cam.vendor}
        </h1>
        <dl className="kv">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className={k === 'Note' || k === 'Operator' ? 'wide' : undefined}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        <div className="actions" style={{ marginTop: 10 }}>
          <a className="btn small" href={cam.osm_url} target="_blank" rel="noreferrer noopener">
            OpenStreetMap ↗
          </a>
          <a className="btn small" href={cam.deflock_url} target="_blank" rel="noreferrer noopener">
            DeFlock map ↗
          </a>
          {portal && (
            <a
              className="btn small"
              href={portal}
              target="_blank"
              rel="noreferrer noopener"
              title="Search for this operator's Flock transparency portal (camera count, retention, sharing)"
            >
              Transparency portal ↗
            </a>
          )}
        </div>
      </section>
      <section className="isec">
        <h3>In view · {inView.length}</h3>
        <div className="alprsum">
          <div>
            <small>Operators</small>
            <ul>
              {operators.map(([k, n]) => (
                <li key={k}>
                  <span>{k}</span>
                  <b className="mono">{n}</b>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <small>Vendors</small>
            <ul>
              {vendors.map(([k, n]) => (
                <li key={k}>
                  <span>{k}</span>
                  <b className="mono">{n}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="isec">
        <details>
          <summary>All mapped tags ({Object.keys(t).length})</summary>
          <dl className="kv tags">
            {Object.entries(t).map(([k, v]) => (
              <div key={k} className="wide">
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
        <p className="quiet small">
          Mapped by OpenStreetMap volunteers (ODbL), the dataset DeFlock maintains. Locations only: there is no public
          plate data and Argus never looks for any. Mapping can be out of date.
        </p>
      </section>
    </div>
  );
}
