import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Brand from '../components/Brand';
import LiveFrame from '../components/LiveFrame';
import { BAND_LABEL } from '../components/SituationPanel';
import { channelById, DEFAULT_TABS } from '../config/newsChannels';
import {
  type Aircraft,
  type EventItem,
  getAircraft,
  getEvents,
  getGps,
  getMapConfig,
  getTension,
  type GpsCell,
  type Me,
  type Tension,
} from '../lib/api';
import { ago, SEVERITY_COLOR, SEVERITY_NAME, zoneTime } from '../lib/format';
import { DEFAULT_AIRSPACE } from '../map/airspaceLayer';
import Globe, { type GlobeHandle, type Imagery } from '../map/Globe';
import { DEFAULT_INFRA } from '../map/infraLayer';
import { DEFAULT_REFERENCE } from '../map/overlays';
import { DEFAULT_SPACE } from '../map/satellites';

// A tour stop: a place on the map with a caption.
interface Stop {
  key: string;
  name: string;
  lat: number;
  lon: number;
  height: number;
  caption: string;
}

const STOP_S = 25;
// A new critical event holds the screen this long before the tour resumes.
const HOLD_S = 60;

function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

// Keep the screen awake while the wall is open (where the browser allows).
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const take = () => {
      if (document.visibilityState === 'visible' && nav.wakeLock) {
        nav.wakeLock
          .request('screen')
          .then((l) => (lock = l))
          .catch(() => undefined);
      }
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

// Burn-in protection: the whole layout drifts by a pixel or two every few
// minutes, and the cursor hides when it's still.
function useDrift(): { x: number; y: number } {
  const [d, setD] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const id = window.setInterval(() => {
      setD({ x: Math.round(Math.random() * 4 - 2), y: Math.round(Math.random() * 4 - 2) });
    }, 180_000);
    return () => window.clearInterval(id);
  }, []);
  return d;
}

function useIdleCursor() {
  useEffect(() => {
    let t: number | undefined;
    const show = () => {
      document.body.classList.remove('nocursor');
      window.clearTimeout(t);
      t = window.setTimeout(() => document.body.classList.add('nocursor'), 3000);
    };
    show();
    window.addEventListener('pointermove', show);
    return () => {
      window.removeEventListener('pointermove', show);
      window.clearTimeout(t);
      document.body.classList.remove('nocursor');
    };
  }, []);
}

// The watch-floor display (/wall): the map on a tour of the theatres in
// big type, with world tension, KPIs, top events, a live channel, clocks
// and a ticker, readable from across the room. Hands-free.
export default function WallPage({ me }: { me: Me }) {
  const globe = useRef<GlobeHandle>(null);
  const now = useNow();
  const drift = useDrift();
  useWakeLock();
  useIdleCursor();
  const [imagery, setImagery] = useState<Imagery | null>(null);
  const [tension, setTension] = useState<Tension | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [gpsCells, setGpsCells] = useState<GpsCell[]>([]);
  const home = me.preferences.home ?? null;
  const wall = me.preferences.wall ?? {};
  const zones = (wall.zones ?? []).slice(0, 4);
  const channel = channelById(wall.channel ?? (me.preferences.news as { channel?: string } | undefined)?.channel ?? DEFAULT_TABS[0]);

  useEffect(() => {
    document.title = 'Wall · Argus';
    getMapConfig()
      .then((c) => setImagery(c.imagery))
      .catch(() => setImagery(null));
  }, []);

  const load = useCallback(async () => {
    const [t, e, a, g] = await Promise.allSettled([getTension(), getEvents({ hours: 24 }), getAircraft(null, false), getGps()]);
    if (t.status === 'fulfilled') setTension(t.value);
    if (e.status === 'fulfilled') setEvents(e.value.events);
    if (a.status === 'fulfilled') setAircraft(a.value.aircraft.filter((x) => x.mil));
    if (g.status === 'fulfilled') setGpsCells(g.value.cells);
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  // The tour: home, then each theatre, most tense first.
  const stops = useMemo<Stop[]>(() => {
    const out: Stop[] = [];
    if (home) out.push({ key: 'home', name: home.name, lat: home.lat, lon: home.lon, height: 1_800_000, caption: 'Home' });
    for (const t of [...(tension?.theatres ?? [])].sort((a, b) => b.level - a.level)) {
      const [w, s, e, n] = t.bbox;
      out.push({
        key: t.key,
        name: t.name,
        lat: (s + n) / 2,
        lon: (w + e) / 2,
        height: Math.max(e - w, n - s) * 140_000,
        caption:
          'Tension ' +
          t.level +
          ' (' +
          (t.change_24h >= 0 ? '+' : '') +
          t.change_24h +
          ' in 24h)' +
          (t.top[0] ? ' · ' + t.top[0].title : ''),
      });
    }
    return out;
  }, [home, tension]);

  const [stopIndex, setStopIndex] = useState(0);
  const [stopAt, setStopAt] = useState(() => Date.now());
  const [interrupt, setInterrupt] = useState<{ event: EventItem; until: number } | null>(null);
  const seenCritical = useRef<Set<string> | null>(null);

  // New critical events interrupt the tour (not the ones there at start).
  useEffect(() => {
    const critical = events.filter((e) => e.severity >= 4);
    if (seenCritical.current === null) {
      seenCritical.current = new Set(critical.map((e) => e.id));
      return;
    }
    const fresh = critical.find((e) => !seenCritical.current?.has(e.id));
    for (const e of critical) seenCritical.current.add(e.id);
    if (fresh) {
      setInterrupt({ event: fresh, until: Date.now() + HOLD_S * 1000 });
      globe.current?.flyTo(fresh.lat, fresh.lon, 600_000);
    }
  }, [events]);

  // Advance the tour every STOP_S seconds (paused while interrupted).
  useEffect(() => {
    if (!stops.length) return;
    if (interrupt && interrupt.until > now.getTime()) return;
    if (interrupt) setInterrupt(null);
    if (now.getTime() - stopAt >= STOP_S * 1000) {
      const next = (stopIndex + 1) % stops.length;
      setStopIndex(next);
      setStopAt(now.getTime());
    }
  }, [now, stops, stopIndex, stopAt, interrupt]);
  const stop = stops[stopIndex % Math.max(1, stops.length)];
  useEffect(() => {
    if (stop && !interrupt) globe.current?.flyTo(stop.lat, stop.lon, stop.height);
    // Fly when the stop changes, not on every tension refresh.
  }, [stop?.key, interrupt]);

  const top = useMemo(
    () => [...events].sort((a, b) => b.severity - a.severity || Date.parse(b.last_updated) - Date.parse(a.last_updated)).slice(0, 5),
    [events],
  );
  const ticker = useMemo(
    () => [...events].sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen)).slice(0, 20),
    [events],
  );
  const w = tension?.world;
  const nextIn = Math.max(0, STOP_S - Math.floor((now.getTime() - stopAt) / 1000));
  // Dim at night (home time, 22:00 to 06:00).
  const hour = Number(zoneTime(home?.tz ?? 'UTC').slice(0, 2));
  const night = hour >= 22 || hour < 6;

  return (
    <div className={'wall' + (night ? ' night' : '')} style={{ transform: 'translate(' + drift.x + 'px,' + drift.y + 'px)' }}>
      <header className="whead">
        <div className="wbrand">
          <Brand />
          <span className="wtitle">· Watch floor</span>
          <small className="mono">UNCLASSIFIED // OPEN SOURCE</small>
        </div>
        <div className="wclocks">
          <div>
            <b className="mono">{now.toISOString().slice(11, 16)}Z</b>
            <small>UTC</small>
          </div>
          {home && (
            <div>
              <b className="mono">{zoneTime(home.tz).slice(0, 5)}</b>
              <small>{home.name}</small>
            </div>
          )}
          {zones.map((z) => (
            <div key={z.tz + z.label}>
              <b className="mono">{zoneTime(z.tz).slice(0, 5)}</b>
              <small>{z.label}</small>
            </div>
          ))}
        </div>
      </header>
      <section className="wmap">
        <Globe
          ref={globe}
          basemap="dark"
          imagery={imagery}
          reference={{ ...DEFAULT_REFERENCE, labels: true }}
          satellites={null}
          space={DEFAULT_SPACE}
          selectedNorad={null}
          followSat={false}
          vessels={[]}
          selectedMmsi={null}
          trackTarget={null}
          airspace={[]}
          airspaceFilters={{ ...DEFAULT_AIRSPACE, gps: true }}
          selectedAirspace={null}
          gpsCells={gpsCells}
          tensionCountries={tension?.countries ?? []}
          showTension
          infra={DEFAULT_INFRA}
          home={home}
          events={events}
          selectedId={interrupt?.event.id ?? null}
          onSelect={() => undefined}
          aircraft={aircraft}
          selectedHex={null}
          trail={null}
          camera="free"
        />
        {(interrupt || stop) && (
          <div className={'wcaption' + (interrupt ? ' alert' : '')}>
            <small className="mono">
              {interrupt
                ? 'NEW ' + SEVERITY_NAME[interrupt.event.severity].toUpperCase() + ' EVENT'
                : 'TOUR ' + (stopIndex + 1) + '/' + stops.length + ' · NEXT IN ' + nextIn + ' S'}
            </small>
            <b>{interrupt ? interrupt.event.title : stop?.name}</b>
            <span>{interrupt ? interrupt.event.place + ' · ' + ago(interrupt.event.first_seen) : stop?.caption}</span>
          </div>
        )}
      </section>
      <aside className="wside">
        <div className="wpanel">
          <h3>World tension</h3>
          <div className="wgauge">
            <span className="mono wbig">{w?.level ?? '—'}</span>
            {w && <span className={'cap b-' + w.band}>{BAND_LABEL[w.band]}</span>}
            {w && (
              <small className="wdelta">
                {(w.change_24h >= 0 ? '+' : '') + w.change_24h} 24h
              </small>
            )}
          </div>
          <div className="gbar">
            <i style={{ left: (w?.level ?? 0) + '%' }} />
          </div>
        </div>
        <div className="wpanel wkpis">
          <div>
            <small>Events 24h</small>
            <b className="mono">{events.length}</b>
          </div>
          <div>
            <small>Military aircraft</small>
            <b className="mono">{aircraft.length}</b>
          </div>
          <div>
            <small>Critical events</small>
            <b className="mono">{events.filter((e) => e.severity >= 4).length}</b>
          </div>
          <div>
            <small>GPS jam cells</small>
            <b className="mono">{gpsCells.filter((c) => c.level !== 'low').length}</b>
          </div>
        </div>
        <div className="wpanel">
          <h3>Top events</h3>
          <ul className="wtop">
            {top.map((e) => (
              <li key={e.id} style={{ ['--c' as string]: SEVERITY_COLOR[e.severity] }}>
                <b>{e.title}</b>
                <span>
                  {e.place}
                  <i className="mono">{ago(e.first_seen)}</i>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {wall.news !== false && (
          <div className="wpanel wvideo">
            <LiveFrame channel={channel} />
            <b>{channel.name}</b>
          </div>
        )}
      </aside>
      <footer className="wticker">
        <span className="wlatest">LATEST</span>
        <div className="wtrack">
          <div className="wmove">
            {[...ticker, ...ticker].map((e, i) => (
              <span key={e.id + i} style={{ ['--c' as string]: SEVERITY_COLOR[e.severity] }}>
                <b className="mono">{SEVERITY_NAME[e.severity].toUpperCase()}</b> {e.title} · {e.place} · {ago(e.first_seen)}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
