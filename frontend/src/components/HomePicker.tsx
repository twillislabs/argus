import { useEffect, useRef, useState } from 'react';

import { type Home, nearestPlace, type Place, searchPlaces } from '../lib/api';
import { browserTimeZone } from '../lib/format';

interface Props {
  value: Home | null;
  onChange: (home: Home | null) => void;
}

const RADII = [100, 250, 500, 1000, 2000];

// Search the bundled GeoNames list (cities of 15,000+ people) through the
// API, or type coordinates; the time zone comes from the nearest place.
export default function HomePicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [lat, setLat] = useState(value ? String(value.lat) : '');
  const [lon, setLon] = useState(value ? String(value.lon) : '');
  const [name, setName] = useState(value?.name ?? '');
  const [radius, setRadius] = useState(value?.radius_km ?? 500);
  const [tz, setTz] = useState<string>(value?.tz ?? browserTimeZone());
  const [picked, setPicked] = useState<string | null>(null);
  const tzRequest = useRef(0);

  // Debounced place search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = window.setTimeout(() => {
      searchPlaces(q)
        .then((r) => setResults(r.places))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => window.clearTimeout(id);
  }, [query]);

  function emit(next: { lat?: string; lon?: string; name?: string; radius?: number; tz?: string }) {
    const la = parseFloat(next.lat ?? lat);
    const lo = parseFloat(next.lon ?? lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      onChange(null);
      return;
    }
    onChange({
      name: ((next.name ?? name).trim() || 'Home').slice(0, 60),
      lat: Math.round(la * 1e5) / 1e5,
      lon: Math.round(lo * 1e5) / 1e5,
      radius_km: next.radius ?? radius,
      tz: next.tz ?? tz,
    });
  }

  // When coordinates are typed by hand, look up the time zone.
  function coordsChanged(nextLat: string, nextLon: string) {
    setPicked(null);
    emit({ lat: nextLat, lon: nextLon });
    const la = parseFloat(nextLat);
    const lo = parseFloat(nextLon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    const req = ++tzRequest.current;
    nearestPlace(la, lo)
      .then((r) => {
        if (req !== tzRequest.current || !r.place) return;
        setTz(r.place.tz);
        emit({ lat: nextLat, lon: nextLon, tz: r.place.tz });
      })
      .catch(() => undefined);
  }

  function pick(p: Place) {
    setLat(String(p.lat));
    setLon(String(p.lon));
    setName(p.name);
    setTz(p.tz);
    setPicked(p.label);
    emit({ lat: String(p.lat), lon: String(p.lon), name: p.name, tz: p.tz });
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="hp-q">Search for a city or town</label>
        <input
          id="hp-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Goodlettsville, TN or Warsaw"
          autoComplete="off"
        />
        {(results.length > 0 || (query.trim().length >= 2 && !searching)) && (
          <ul className="citylist">
            {results.map((p) => (
              <li key={p.label + p.lat}>
                <button type="button" aria-pressed={picked === p.label} onClick={() => pick(p)}>
                  <span>{p.label}</span>
                  <small>
                    {p.lat.toFixed(2)}, {p.lon.toFixed(2)}
                  </small>
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="hint pad">
                No match. Places with 15,000+ people are listed; for anywhere else enter
                coordinates below.
              </li>
            )}
          </ul>
        )}
        <span className="hint">Place data: GeoNames (CC BY 4.0), searched on your server.</span>
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
              coordsChanged(e.target.value, lon);
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
              coordsChanged(lat, e.target.value);
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
      <span className="hint">Time zone: {tz}</span>
    </div>
  );
}
