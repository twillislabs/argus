// What a wall screen shows: its tour (home, theatres, places), how long
// each stop lasts, whether new critical events interrupt, its map layers,
// the news channel and clocks. Used for your own wall (Settings > Display)
// and for each paired screen (Settings > Displays).

import { useEffect, useState } from 'react';

import { CHANNELS } from '../config/newsChannels';
import {
  getTension,
  type Home,
  search,
  type SearchResult,
  WALL_LAYERS,
  WALL_SECTIONS,
  wallLayerOn,
  wallSectionOn,
  type WallPrefs,
  type WallStop,
} from '../lib/api';
import { linkCamera } from '../lib/share';
import HomePicker from './HomePicker';

// How close a place stop looks (camera height, metres).
const ZOOMS = [
  { label: 'City', height: 120_000 },
  { label: 'Region', height: 700_000 },
  { label: 'Country', height: 2_000_000 },
  { label: 'Continent', height: 6_000_000 },
];

function stopLabel(s: WallStop, theatres: Map<string, string>): string {
  if (s.kind === 'home') return 'Home';
  if (s.kind === 'theatres') return 'Every theatre, most tense first';
  if (s.kind === 'theatre') return 'Theatre · ' + (theatres.get(s.key ?? '') ?? s.key);
  return s.name ?? 'Place';
}

// "Taipei, Taiwan, Taiwan" -> "Taipei, Taiwan".
const placeName = (label: string) => [...new Set(label.split(',').map((x) => x.trim()))].join(', ').slice(0, 80);

interface Props {
  value: WallPrefs;
  // For a paired screen: its home (tour stop, clock, night dimming).
  home?: Home | null;
  withHome?: boolean;
  // The screen follows a profile: only its home is its own.
  homeOnly?: boolean;
  onSave: (wall: WallPrefs, home: Home | null) => Promise<void>;
}

export default function WallEditor({
  value,
  home: savedHome = null,
  withHome = false,
  homeOnly = false,
  onSave,
}: Props) {
  const [wall, setWall] = useState<WallPrefs>(value);
  const [home, setHome] = useState<Home | null>(savedHome);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [theatres, setTheatres] = useState<Map<string, string>>(new Map());
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [zoom, setZoom] = useState(ZOOMS[1].height);
  const zoneNames =
    (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  const stops = wall.stops?.length ? wall.stops : [{ kind: 'home' } as WallStop, { kind: 'theatres' } as WallStop];
  const zones = wall.zones ?? [];

  useEffect(() => {
    getTension()
      .then((t) => setTheatres(new Map(t.theatres.map((x) => [x.key, x.name]))))
      .catch(() => undefined);
  }, []);

  const change = (next: Partial<WallPrefs>) => {
    setWall((w) => ({ ...w, ...next }));
    setDirty(true);
    setStatus('');
  };
  const setStops = (next: WallStop[]) => change({ stops: next });

  async function save() {
    setStatus('Saving…');
    try {
      await onSave(wall, home);
      setDirty(false);
      setStatus('Saved. Screens pick this up within a minute.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  async function find(e: React.FormEvent) {
    e.preventDefault();
    const cam = linkCamera(q.trim());
    if (cam) {
      setStops([...stops, { kind: 'place', name: 'Map view', ...cam }]);
      setQ('');
      return;
    }
    if (q.trim().length < 2) return;
    try {
      const r = await search(q.trim());
      setResults(r.results.filter((x) => x.lat != null && x.lon != null).slice(0, 6));
    } catch {
      setResults([]);
    }
  }

  const move = (i: number, d: number) => {
    const next = [...stops];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
  };

  return (
    <div className="srows wedit">
      {withHome && (
        <div className="srow col">
          <span className="srow-label">
            <b>Screen home</b>
            <small>Its home stop, home clock and night dimming (22:00 to 06:00 there)</small>
          </span>
          <HomePicker
            value={home}
            onChange={(h) => {
              setHome(h);
              setDirty(true);
            }}
          />
        </div>
      )}
      {!homeOnly && (
        <>
          <div className="srow col">
            <span className="srow-label">
              <b>Tour</b>
              <small>The screen flies to each stop in turn. Leave one stop to keep it on that area.</small>
            </span>
            <ol className="stoplist">
              {stops.map((s, i) => (
                <li key={i}>
                  <span className="mono quiet">{i + 1}</span>
                  <span>{stopLabel(s, theatres)}</span>
                  <span className="stopbtns">
                    <button className="btn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button
                      className="btn small"
                      aria-label="Move down"
                      disabled={i === stops.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="btn small"
                      aria-label="Remove stop"
                      disabled={stops.length === 1}
                      onClick={() => setStops(stops.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="stopadd">
              <button className="btn small" onClick={() => setStops([...stops, { kind: 'home' }])}>
                + Home
              </button>
              <button className="btn small" onClick={() => setStops([...stops, { kind: 'theatres' }])}>
                + Every theatre
              </button>
              <select
                value=""
                aria-label="Add a theatre"
                onChange={(e) => e.target.value && setStops([...stops, { kind: 'theatre', key: e.target.value }])}
              >
                <option value="">+ One theatre…</option>
                {[...theatres].map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={() => change({ stops: undefined })}>
                Reset tour
              </button>
            </div>
            <form className="stopfind" onSubmit={(e) => void find(e)}>
              <input
                value={q}
                placeholder="Add a place: search, coordinates, or paste a map link"
                aria-label="Add a place"
                onChange={(e) => setQ(e.target.value)}
              />
              <select value={zoom} aria-label="Zoom" onChange={(e) => setZoom(Number(e.target.value))}>
                {ZOOMS.map((z) => (
                  <option key={z.label} value={z.height}>
                    {z.label}
                  </option>
                ))}
              </select>
              <button className="btn small">Find</button>
            </form>
            {results.length > 0 && (
              <ul className="stopresults">
                {results.map((r, i) => (
                  <li key={i}>
                    <button
                      className="btn small"
                      onClick={() => {
                        setStops([
                          ...stops,
                          { kind: 'place', name: placeName(r.label), lat: r.lat, lon: r.lon, height: zoom },
                        ]);
                        setResults([]);
                        setQ('');
                      }}
                    >
                      + {r.label}
                      <small className="quiet"> {r.detail}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Seconds per stop</b>
              <small>10 to 600</small>
            </span>
            <input
              className="numin mono"
              type="number"
              min={10}
              max={600}
              value={wall.stop_s ?? 25}
              onChange={(e) => change({ stop_s: Math.max(10, Math.min(600, Number(e.target.value) || 25)) })}
            />
          </div>
          <label className="srow">
            <span className="srow-label">
              <b>Interrupt for critical events</b>
              <small>A new critical event holds the screen for a minute</small>
            </span>
            <span className="lrow flat">
              <input
                type="checkbox"
                checked={wall.interrupt !== false}
                onChange={(e) => change({ interrupt: e.target.checked })}
              />
              <span className="tog" />
            </span>
          </label>
          <div className="srow col">
            <span className="srow-label">
              <b>Map layers</b>
            </span>
            {[...new Set(WALL_LAYERS.map((l) => l.group))].map((group) => (
              <div key={group} className="wlgroup">
                <small>{group}</small>
                <div className="wlayers">
                  {WALL_LAYERS.filter((l) => l.group === group).map((l) => (
                    <label key={l.id} className="lrow flat wlayer">
                      <input
                        type="checkbox"
                        checked={wallLayerOn(wall, l.id)}
                        onChange={(e) => change({ layers: { ...wall.layers, [l.id]: e.target.checked } })}
                      />
                      <span className="tog" />
                      <span>{l.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="srow col">
            <span className="srow-label">
              <b>Sections</b>
              <small>Show or hide parts of the screen; the map grows into the space</small>
            </span>
            <div className="wlayers">
              {WALL_SECTIONS.map((x) => (
                <label key={x.id} className="lrow flat wlayer" title={x.hint}>
                  <input
                    type="checkbox"
                    checked={wallSectionOn(wall, x.id)}
                    onChange={(e) =>
                      change({
                        sections: { ...wall.sections, [x.id]: e.target.checked },
                        // The old news switch follows the section.
                        ...(x.id === 'news' ? { news: e.target.checked } : {}),
                      })
                    }
                  />
                  <span className="tog" />
                  <span>{x.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Channel</b>
              <small>Defaults to the first news channel</small>
            </span>
            <select
              value={wall.channel ?? ''}
              disabled={wall.news === false}
              onChange={(e) => change({ channel: e.target.value || undefined })}
            >
              <option value="">First news channel</option>
              {CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="srow">
            <span className="srow-label">
              <b>Clocks</b>
              <small>UTC and home always show; add up to four more</small>
            </span>
            <div className="zonelist">
              {zones.map((z, i) => (
                <div key={i} className="zonerow">
                  <input
                    value={z.label}
                    maxLength={16}
                    placeholder="Label"
                    aria-label="Clock label"
                    onChange={(e) =>
                      change({ zones: zones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                    }
                  />
                  <select
                    value={z.tz}
                    aria-label="Time zone"
                    onChange={(e) =>
                      change({ zones: zones.map((x, j) => (j === i ? { ...x, tz: e.target.value } : x)) })
                    }
                  >
                    {zoneNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn small"
                    aria-label="Remove clock"
                    onClick={() => change({ zones: zones.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
              ))}
              {zones.length < 4 && (
                <button
                  className="btn small"
                  onClick={() => change({ zones: [...zones, { label: 'Kyiv', tz: 'Europe/Kyiv' }] })}
                >
                  Add clock
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div className="srow">
        <span className="quiet small">{status}</span>
        <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}
