import { useEffect } from 'react';

import { api } from '../lib/api';

// Recent imagery (toolbar > Imagery, draw a box): the recent Sentinel
// passes over the box, the chosen one draped on the map, opacity, and a
// before/after split against an older pass. The state lives in MapPage,
// so the imagery stays while you look at other things.

export type ImageryKind = 'optical' | 'radar';

export interface Pass {
  date: string;
  time: string;
  platforms: string[];
  cloud: number | null;
  scenes: number;
}

export interface ImageryState {
  box: [number, number, number, number];
  kind: ImageryKind;
  passes: Pass[] | null;
  error: string;
  date: string | null;
  tiles: string | null;
  before: string | null;
  beforeTiles: string | null;
  alpha: number;
  split: number;
}

export const newImagery = (box: ImageryState['box']): ImageryState => ({
  box,
  kind: 'optical',
  passes: null,
  error: '',
  date: null,
  tiles: null,
  before: null,
  beforeTiles: null,
  alpha: 1,
  split: 0.5,
});

const bboxParam = (b: ImageryState['box']) => b.map((x) => x.toFixed(4)).join(',');

async function mosaic(s: ImageryState, date: string): Promise<string> {
  const r = await api<{ tiles: string }>(
    '/api/imagery/mosaic?kind=' + s.kind + '&bbox=' + bboxParam(s.box) + '&date=' + date,
  );
  return r.tiles;
}

// The newest clear pass (radar is always clear), else the newest with
// some cloud, else the newest.
function pick(passes: Pass[]): string | null {
  const under = (pct: number) => passes.find((p) => p.cloud === null || p.cloud <= pct);
  return (under(10) ?? under(30) ?? passes[0])?.date ?? null;
}

const KM_PER_DEG = 111.32;

export default function ImageryPanel({
  state,
  onChange,
  onClose,
  onFly,
}: {
  state: ImageryState;
  onChange: (next: (s: ImageryState) => ImageryState) => void;
  onClose: () => void;
  onFly: () => void;
}) {
  const s = state;
  const [w, south, e, n] = s.box;
  const widthKm = (e - w) * KM_PER_DEG * Math.cos((((south + n) / 2) * Math.PI) / 180);
  const heightKm = (n - south) * KM_PER_DEG;

  // The passes for this box and kind (once; kept while the panel comes
  // and goes).
  useEffect(() => {
    if (s.passes !== null || s.error) return;
    let cancelled = false;
    api<{ passes: Pass[] }>('/api/imagery/passes?kind=' + s.kind + '&bbox=' + bboxParam(s.box))
      .then(async (r) => {
        if (cancelled) return;
        const date = pick(r.passes);
        const tiles = date ? await mosaic(s, date) : null;
        if (!cancelled) onChange((x) => ({ ...x, passes: r.passes, date, tiles, before: null, beforeTiles: null }));
      })
      .catch((err) => {
        if (!cancelled)
          onChange((x) => ({ ...x, passes: [], error: err instanceof Error ? err.message : 'Could not search.' }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.kind, s.box.join(), s.passes === null, s.error]);

  async function choose(date: string, which: 'main' | 'before') {
    try {
      const tiles = await mosaic(s, date);
      onChange((x) =>
        which === 'main' ? { ...x, date, tiles, error: '' } : { ...x, before: date, beforeTiles: tiles, error: '' },
      );
    } catch (err) {
      onChange((x) => ({ ...x, error: err instanceof Error ? err.message : 'Could not load that pass.' }));
    }
  }

  const setKind = (kind: ImageryKind) =>
    onChange((x) =>
      x.kind === kind
        ? x
        : { ...x, kind, passes: null, error: '', date: null, tiles: null, before: null, beforeTiles: null },
    );

  return (
    <div className="inspector-body imagery">
      <div className="isec tight">
        <button className="backlink" onClick={onClose}>
          ← Situation (remove imagery)
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: '#7fd1c7' }}>
            Recent imagery
          </span>
          <span className="badge mono">
            {Math.round(widthKm)} × {Math.round(heightKm)} km
          </span>
        </div>
        <h1 className="etitle">{s.kind === 'optical' ? 'Sentinel-2 · true colour' : 'Sentinel-1 · radar'}</h1>
        <div className="sub">
          {s.kind === 'optical'
            ? 'About 10 m detail, every 2 to 5 days; needs daylight and clear skies.'
            : 'Sees through cloud and at night, about every 6 to 12 days. Bright is rough or metal (buildings, ships), dark is smooth (water, runways).'}
        </div>
        <div className="actions">
          <div className="seg small" role="group" aria-label="Kind of imagery">
            <button aria-pressed={s.kind === 'optical'} onClick={() => setKind('optical')}>
              Optical
            </button>
            <button aria-pressed={s.kind === 'radar'} onClick={() => setKind('radar')}>
              Radar
            </button>
          </div>
          <button className="btn small" onClick={onFly}>
            Fly to
          </button>
        </div>
      </section>
      <section className="isec">
        <h3>Passes, last 60 days{s.passes ? ' · ' + s.passes.length : ''}</h3>
        {s.error && <p className="err small">{s.error}</p>}
        {s.passes === null ? (
          <p className="quiet small">Searching the Sentinel catalogue…</p>
        ) : s.passes.length === 0 ? (
          !s.error && <p className="quiet small">No passes over this box in the last 60 days.</p>
        ) : (
          <ul className="passlist">
            {s.passes.map((p) => (
              <li key={p.date} className={p.date === s.date ? 'on' : p.date === s.before ? 'before' : undefined}>
                <button className="passpick" onClick={() => void choose(p.date, 'main')}>
                  <b className="mono">{p.date}</b>
                  <span>
                    {p.cloud !== null
                      ? Math.round(p.cloud) + '% cloud'
                      : p.platforms.join(', ').replace(/sentinel-/i, 'S')}
                  </span>
                </button>
                {p.date !== s.date && (
                  <button
                    className="btn small"
                    title="Show this pass left of the split line, to compare"
                    aria-pressed={p.date === s.before}
                    onClick={() =>
                      p.date === s.before
                        ? onChange((x) => ({ ...x, before: null, beforeTiles: null }))
                        : void choose(p.date, 'before')
                    }
                  >
                    {p.date === s.before ? 'Comparing' : 'Compare'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {s.tiles && (
        <section className="isec">
          <div className="field">
            <label htmlFor="im-alpha">Opacity · {Math.round(s.alpha * 100)}%</label>
            <input
              id="im-alpha"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={s.alpha}
              onChange={(ev) => onChange((x) => ({ ...x, alpha: Number(ev.target.value) }))}
            />
          </div>
          {s.before && (
            <div className="field">
              <label htmlFor="im-split">
                Split · {s.before} on the left, {s.date} on the right
              </label>
              <input
                id="im-split"
                type="range"
                min={0.05}
                max={0.95}
                step={0.01}
                value={s.split}
                onChange={(ev) => onChange((x) => ({ ...x, split: Number(ev.target.value) }))}
              />
            </div>
          )}
          <p className="quiet small">
            Imagery shows from city zoom in (zoom level 8 to 15). Tiles are fetched by this server and kept a week.
          </p>
        </section>
      )}
      <section className="isec">
        <p className="quiet small">
          Contains modified Copernicus Sentinel data, via Microsoft Planetary Computer. Imagery is days old, not live.
        </p>
      </section>
    </div>
  );
}
