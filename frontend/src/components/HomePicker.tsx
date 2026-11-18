import { useMemo, useState } from 'react';

import type { Home } from '../lib/api';
import { CITIES, nearestTimeZone } from '../lib/cities';

interface Props {
  value: Home | null;
  onChange: (home: Home | null) => void;
}

const RADII = [100, 250, 500, 1000, 2000];

export default function HomePicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [lat, setLat] = useState(value ? String(value.lat) : '');
  const [lon, setLon] = useState(value ? String(value.lon) : '');
  const [name, setName] = useState(value?.name ?? '');
  const [radius, setRadius] = useState(value?.radius_km ?? 500);
  const [tz, setTz] = useState<string | null>(value?.tz ?? null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CITIES.filter(
      (c) => !q || (c.name + ' ' + c.country).toLowerCase().includes(q),
    ).slice(0, q ? 8 : 6);
  }, [query]);

  function emit(next: {
    lat?: string;
    lon?: string;
    name?: string;
    radius?: number;
    tz?: string | null;
  }) {
    const la = parseFloat(next.lat ?? lat);
    const lo = parseFloat(next.lon ?? lon);
    const label = (next.name ?? name).trim() || 'Home';
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      onChange(null);
      return;
    }
    const zone = (next.tz !== undefined ? next.tz : tz) ?? nearestTimeZone(la, lo);
    onChange({
      name: label.slice(0, 60),
      lat: Math.round(la * 1e4) / 1e4,
      lon: Math.round(lo * 1e4) / 1e4,
      radius_km: next.radius ?? radius,
      tz: zone,
    });
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="hp-q">Search for a city</label>
        <input
          id="hp-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Nashville, Warsaw, Tokyo"
          autoComplete="off"
        />
        <ul className="citylist">
          {matches.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                aria-pressed={value?.name === c.name}
                onClick={() => {
                  setLat(String(c.lat));
                  setLon(String(c.lon));
                  setName(c.name);
                  setTz(c.tz);
                  emit({ lat: String(c.lat), lon: String(c.lon), name: c.name, tz: c.tz });
                }}
              >
                <span>
                  {c.name}, {c.country}
                </span>
                <small>
                  {c.lat.toFixed(2)}, {c.lon.toFixed(2)}
                </small>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="hint pad">No match. Enter coordinates below.</li>
          )}
        </ul>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="hp-lat">Latitude</label>
          <input
            id="hp-lat"
            inputMode="decimal"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              setTz(null);
              emit({ lat: e.target.value, tz: null });
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="hp-lon">Longitude</label>
          <input
            id="hp-lon"
            inputMode="decimal"
            value={lon}
            onChange={(e) => {
              setLon(e.target.value);
              setTz(null);
              emit({ lon: e.target.value, tz: null });
            }}
          />
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="hp-name">Label</label>
          <input
            id="hp-name"
            value={name}
            placeholder="Home"
            onChange={(e) => {
              setName(e.target.value);
              emit({ name: e.target.value });
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="hp-radius">Alert radius</label>
          <select
            id="hp-radius"
            value={radius}
            onChange={(e) => {
              const r = Number(e.target.value);
              setRadius(r);
              emit({ radius: r });
            }}
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r.toLocaleString()} km
              </option>
            ))}
          </select>
        </div>
      </div>
      <span className="hint">
        {value ? 'Time zone: ' + value.tz : 'The time zone comes from the nearest city.'}
      </span>
    </div>
  );
}
