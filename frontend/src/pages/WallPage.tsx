import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Brand from '../components/Brand';
import LiveFrame from '../components/LiveFrame';
import { BAND_LABEL } from '../components/SituationPanel';
import { CHANNELS, channelById, DEFAULT_TABS } from '../config/newsChannels';
import {
  type Aircraft,
  type EventItem,
  type AirspaceItem,
  getAircraft,
  getAirspace,
  getEvents,
  getGps,
  getMapConfig,
  getMe,
  getTension,
  type GpsCell,
  type Me,
  type Tension,
  type TensionTheatre,
  wallLayerOn,
  wallSectionOn,
  type WallSection,
  type WallStop,
  type Advisory,
  type OutlookArea,
  type Vessel,
  type WeatherNow,
  type WikiItem,
  type WxAlert,
  getAdvisories,
  getOutlook,
  getSatelliteCatalog,
  getVessels,
  getWallProfile,
  getWallSync,
  getWeatherNow,
  getWikipedia,
  getWxAlerts,
} from '../lib/api';
import { ago, SEVERITY_COLOR, SEVERITY_NAME, zoneTime } from '../lib/format';
import { temperature, windSpeed } from '../lib/units';
import { DEFAULT_AIRSPACE } from '../map/airspaceLayer';
import Globe, { type GlobeHandle, type Imagery } from '../map/Globe';
import { DEFAULT_INFRA } from '../map/infraLayer';
import { DEFAULT_REFERENCE } from '../map/overlays';
import { DEFAULT_SPACE, type SatCatalog } from '../map/satellites';

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
const NO_EVENTS: EventItem[] = [];
const DEFAULT_STOPS: WallStop[] = [{ kind: 'home' }, { kind: 'theatres' }];

function theatreStop(t: TensionTheatre): Stop {
  const [w, s, e, n] = t.bbox;
  return {
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
  };
}
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
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
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
  // null until the first answer.
  const [loadedEvents, setEvents] = useState<EventItem[] | null>(null);
  const events = loadedEvents ?? NO_EVENTS;
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [gpsCells, setGpsCells] = useState<GpsCell[]>([]);
  const [airspace, setAirspace] = useState<AirspaceItem[]>([]);
  // Layers a wall profile can add.
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [wx, setWx] = useState<{ alerts: WxAlert[]; zoned: WxAlert[]; local: WxAlert[] }>({
    alerts: [],
    zoned: [],
    local: [],
  });
  const [outlook, setOutlook] = useState<OutlookArea[]>([]);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [wiki, setWiki] = useState<WikiItem[]>([]);
  const [stations, setStations] = useState<SatCatalog | null>(null);
  const [weatherNow, setWeatherNow] = useState<WeatherNow | null>(null);
  // Settings can change while the screen runs (an admin edits it in
  // Settings > Displays): re-read them every minute.
  // /wall?profile=<id> shows that wall profile (to preview it, or for a
  // screen signed in as a person); a paired screen gets its own from
  // /api/me.
  const profileId = new URLSearchParams(window.location.search).get('profile');
  const [prefs, setPrefs] = useState(me.preferences);
  useEffect(() => {
    const refresh = () => {
      getMe()
        .then(async (m) => {
          if (profileId) {
            const p = await getWallProfile(profileId);
            setPrefs({ ...m.preferences, wall: p.wall });
          } else {
            setPrefs(m.preferences);
          }
        })
        .catch(() => undefined);
    };
    if (profileId) refresh();
    const id = window.setInterval(refresh, 60_000);
    // Pushed changes (Settings > Displays: saving, Sync now, Reload):
    // check every 10 s; the first answer, or one after an API restart
    // (a new boot id), is just the baseline.
    let seen: { boot: string; sync: number; reload: number } | null = null;
    const checkSync = () =>
      getWallSync()
        .then((s) => {
          if (seen && s.boot === seen.boot) {
            if (s.reload > seen.reload) {
              window.location.reload();
              return;
            }
            if (s.sync > seen.sync) refresh();
          }
          seen = s;
        })
        .catch(() => undefined);
    void checkSync();
    const syncId = window.setInterval(checkSync, 10_000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(syncId);
    };
  }, [profileId]);
  const home = prefs.home ?? null;
  const wall = prefs.wall ?? {};
  const stopS = wall.stop_s ?? STOP_S;
  const interrupts = wall.interrupt !== false;
  const on = (id: Parameters<typeof wallLayerOn>[1]) => wallLayerOn(wall, id);
  const show = (id: WallSection) => wallSectionOn(wall, id);
  // Which optional layers to load (a string, so the loader reruns only
  // when the set changes).
  const extras = (['ships', 'wx_alerts', 'wx_zones', 'wx_outlook', 'advisories', 'wiki', 'stations'] as const)
    .filter((k) => on(k))
    .join(',');
  const wantWeather = show('weather');
  const zones = (wall.zones ?? []).slice(0, 4);
  const channel = channelById(
    wall.channel ?? (prefs.news as { channel?: string } | undefined)?.channel ?? DEFAULT_TABS[0],
  );

  useEffect(() => {
    document.title = 'Wall · Argus';
    getMapConfig()
      .then((c) => setImagery(c.imagery))
      .catch(() => setImagery(null));
  }, []);

  // When the wall last heard from Argus: the LIVE pill turns OFFLINE if
  // that's over two and a half minutes ago (it refreshes every minute).
  const [lastOk, setLastOk] = useState<number | null>(null);
  const load = useCallback(async () => {
    const [t, e, a, g, s] = await Promise.allSettled([
      getTension(),
      getEvents({ hours: 24 }),
      getAircraft(null, false),
      getGps(),
      getAirspace(),
    ]);
    if (t.status === 'fulfilled') setTension(t.value);
    if (e.status === 'fulfilled') {
      setEvents(e.value.events);
      setLastOk(Date.now());
    }
    else setEvents((x) => x ?? []);
    if (a.status === 'fulfilled') setAircraft(a.value.aircraft.filter((x) => x.mil));
    if (g.status === 'fulfilled') setGpsCells(g.value.cells);
    if (s.status === 'fulfilled') setAirspace(s.value.items);
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  // The optional layers, every two minutes while they're on.
  useEffect(() => {
    const want = new Set(extras.split(',').filter(Boolean));
    let cancelled = false;
    async function loadExtras() {
      const jobs: Promise<unknown>[] = [];
      if (want.has('ships')) jobs.push(getVessels(null).then((r) => !cancelled && setVessels(r.vessels)));
      else setVessels([]);
      if (want.has('wx_alerts') || want.has('wx_zones'))
        jobs.push(getWxAlerts(null, want.has('wx_zones')).then((r) => !cancelled && setWx(r)));
      if (want.has('wx_outlook')) jobs.push(getOutlook().then((r) => !cancelled && setOutlook(r.areas)));
      if (want.has('advisories')) jobs.push(getAdvisories().then((r) => !cancelled && setAdvisories(r.countries)));
      if (want.has('wiki')) jobs.push(getWikipedia().then((r) => !cancelled && setWiki(r.items)));
      await Promise.allSettled(jobs);
    }
    void loadExtras();
    const id = window.setInterval(() => void loadExtras(), 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [extras]);

  // The crewed stations only (a few objects), for the Space stations layer.
  const wantStations = on('stations');
  useEffect(() => {
    if (!wantStations) {
      setStations(null);
      return;
    }
    getSatelliteCatalog('station')
      .then((body) =>
        setStations({
          updated: body.updated,
          raw: body.satellites,
          meta: body.satellites.map((r) => ({
            norad: Number(r[0]),
            name: String(r[1]),
            cospar: String(r[2]),
            cls: r[3] as SatCatalog['meta'][number]['cls'],
            tags: (r[4] as string[]) ?? [],
          })),
        }),
      )
      .catch(() => undefined);
  }, [wantStations]);

  // Weather at home (a section), every 15 minutes.
  useEffect(() => {
    if (!wantWeather || !home) return;
    const loadWeather = () => {
      getWeatherNow(home.lat, home.lon)
        .then(setWeatherNow)
        .catch(() => undefined);
      getWxAlerts(home, false)
        .then((r) => setWx((x) => ({ ...x, local: r.local })))
        .catch(() => undefined);
    };
    loadWeather();
    const id = window.setInterval(loadWeather, 900_000);
    return () => window.clearInterval(id);
  }, [wantWeather, home?.lat, home?.lon]);

  // The tour, from the screen's settings; by default home, then each
  // theatre, most tense first.
  const plan = JSON.stringify(wall.stops?.length ? wall.stops : DEFAULT_STOPS);
  const stops = useMemo<Stop[]>(() => {
    const out: Stop[] = [];
    const theatres = tension?.theatres ?? [];
    (JSON.parse(plan) as WallStop[]).forEach((st, i) => {
      if (st.kind === 'home' && home) {
        out.push({ key: 'home', name: home.name, lat: home.lat, lon: home.lon, height: 1_800_000, caption: 'Home' });
      } else if (st.kind === 'theatres') {
        for (const t of [...theatres].sort((a, b) => b.level - a.level)) out.push(theatreStop(t));
      } else if (st.kind === 'theatre') {
        const t = theatres.find((x) => x.key === st.key);
        if (t) out.push(theatreStop(t));
      } else if (st.kind === 'place' && st.lat != null && st.lon != null) {
        out.push({
          key: 'place:' + i,
          name: st.name ?? 'Place',
          lat: st.lat,
          lon: st.lon,
          height: st.height ?? 1_500_000,
          caption: '',
        });
      }
    });
    // The same theatre twice in a row (listed and in "every theatre") once.
    return out.filter((x, i) => i === 0 || out[i - 1].key !== x.key);
  }, [plan, home, tension]);
  const pinned = stops.length === 1;

  const [stopIndex, setStopIndex] = useState(0);
  const [stopAt, setStopAt] = useState(() => Date.now());
  const [interrupt, setInterrupt] = useState<{ event: EventItem; until: number } | null>(null);
  const seenCritical = useRef<Set<string> | null>(null);

  // New critical events interrupt the tour (not the ones there at start).
  useEffect(() => {
    // Wait for the first answer: what's there when the wall opens is old.
    if (loadedEvents === null) return;
    const critical = loadedEvents.filter((e) => e.severity >= 4);
    if (seenCritical.current === null) {
      seenCritical.current = new Set(critical.map((e) => e.id));
      return;
    }
    const fresh = critical.find((e) => !seenCritical.current?.has(e.id));
    for (const e of critical) seenCritical.current.add(e.id);
    if (fresh && interrupts) {
      setInterrupt({ event: fresh, until: Date.now() + HOLD_S * 1000 });
      globe.current?.flyTo(fresh.lat, fresh.lon, 600_000);
    }
  }, [loadedEvents, interrupts]);

  // Advance the tour every stopS seconds (paused while interrupted).
  useEffect(() => {
    if (!stops.length) return;
    if (interrupt && interrupt.until > now.getTime()) return;
    if (interrupt) setInterrupt(null);
    if (!pinned && now.getTime() - stopAt >= stopS * 1000) {
      const next = (stopIndex + 1) % stops.length;
      setStopIndex(next);
      setStopAt(now.getTime());
    }
  }, [now, stops, stopIndex, stopAt, interrupt, pinned, stopS]);
  const stop = stops[stopIndex % Math.max(1, stops.length)];
  useEffect(() => {
    if (stop && !interrupt) globe.current?.flyTo(stop.lat, stop.lon, stop.height);
    // Fly when the stop changes, not on every tension refresh.
  }, [stop?.key, stop?.lat, stop?.lon, stop?.height, interrupt]);

  const top = useMemo(
    () =>
      [...events]
        .sort((a, b) => b.severity - a.severity || Date.parse(b.last_updated) - Date.parse(a.last_updated))
        .slice(0, 5),
    [events],
  );
  const ticker = useMemo(
    () => [...events].sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen)).slice(0, 20),
    [events],
  );
  const w = tension?.world;
  const nextIn = Math.max(0, stopS - Math.floor((now.getTime() - stopAt) / 1000));
  // Dim at night (home time, 22:00 to 06:00).
  const hour = Number(zoneTime(home?.tz ?? 'UTC').slice(0, 2));
  const night = hour >= 22 || hour < 6;

  const side = (['tension', 'kpis', 'top', 'weather', 'news'] as const).some((k) => show(k));
  // The wall's own sound for its live TV: muted at 50% unless set.
  const audio = { muted: wall.muted !== false, volume: wall.volume ?? 50 };
  const fresh = lastOk !== null && now.getTime() - lastOk < 150_000;
  const livePill = (
    <span
      className={'livepill wlive ' + (lastOk === null ? 'connecting' : fresh ? 'live' : 'offline')}
      title="Argus data updates"
    >
      <i />
      {lastOk === null ? 'CONNECTING' : fresh ? 'LIVE' : 'OFFLINE'}
    </span>
  );

  // Live TV only: one channel full screen, or a grid of up to four (sound
  // from the first). Night dimming and drift still apply.
  if (wall.mode === 'tv') {
    // Channels since removed from the list are skipped.
    const picked = (wall.tv_channels ?? []).filter((id) => CHANNELS.some((c) => c.id === id));
    const tv = (picked.length ? picked : [channel.id]).slice(0, 4).map(channelById);
    return (
      <div
        className={'walltv n' + tv.length + (night ? ' night' : '')}
        style={{ transform: 'translate(' + drift.x + 'px,' + drift.y + 'px)' }}
      >
        <div className="tvlive">{livePill}</div>
        {tv.map((c, i) => (
          <div key={c.id + i} className="tvcell">
            <LiveFrame channel={c} audio={i === 0 ? audio : { muted: true, volume: 0 }} />
            <b>{c.name}</b>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={'wall' + (night ? ' night' : '') + (side ? '' : ' noside')}
      style={{ transform: 'translate(' + drift.x + 'px,' + drift.y + 'px)' }}
    >
      {(show('header') || show('clocks')) && (
        <header className="whead">
          {show('header') && (
            <div className="wbrand">
              <Brand />
              <span className="wtitle">· Watch floor</span>
              <small className="mono">UNCLASSIFIED // OPEN SOURCE</small>
            </div>
          )}
          {livePill}
          {show('clocks') && (
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
          )}
        </header>
      )}
      <section className="wmap">
        <Globe
          ref={globe}
          basemap="dark"
          imagery={imagery}
          reference={{ ...DEFAULT_REFERENCE, labels: true, advisories: on('advisories') }}
          advisories={advisories}
          wikiItems={wiki}
          showWiki={on('wiki')}
          wxAlerts={wx.alerts}
          wxZoned={wx.zoned}
          outlook={outlook}
          weather={{
            alerts: on('wx_alerts'),
            zones: on('wx_zones'),
            outlook: on('wx_outlook'),
            clouds: on('clouds'),
            precip: on('precip'),
          }}
          satellites={stations}
          space={{ ...DEFAULT_SPACE, iss: on('stations') }}
          selectedNorad={null}
          followSat={false}
          vessels={on('ships') ? vessels : []}
          selectedMmsi={null}
          trackTarget={null}
          airspace={airspace}
          // By default as in the mock-up: closed airspace hatched, GPS
          // hexes and nuclear plants (cables only when a screen asks).
          airspaceFilters={{
            ...DEFAULT_AIRSPACE,
            czib: on('czib'),
            gps: on('gps'),
            sigmet: on('sigmet'),
            tfr: on('tfr'),
          }}
          selectedAirspace={null}
          gpsCells={gpsCells}
          tensionCountries={tension?.countries ?? []}
          showTension={on('tension')}
          infra={{
            ...DEFAULT_INFRA,
            nuclear: on('nuclear'),
            power: on('power'),
            cables: on('cables'),
            bases: on('bases'),
          }}
          home={home}
          events={on('events') ? events : []}
          selectedId={interrupt?.event.id ?? null}
          onSelect={() => undefined}
          aircraft={on('aircraft') ? aircraft : []}
          selectedHex={null}
          trail={null}
          camera="free"
        />
        {(interrupt || (stop && show('caption'))) && (
          <div className={'wcaption' + (interrupt ? ' alert' : '')}>
            <small className="mono">
              {interrupt
                ? 'NEW ' + SEVERITY_NAME[interrupt.event.severity].toUpperCase() + ' EVENT'
                : pinned
                  ? 'WATCHING'
                  : 'TOUR ' + (stopIndex + 1) + '/' + stops.length + ' · NEXT IN ' + nextIn + ' S'}
            </small>
            <b>{interrupt ? interrupt.event.title : stop?.name}</b>
            {(interrupt || stop?.caption) && (
              <span>{interrupt ? interrupt.event.place + ' · ' + ago(interrupt.event.first_seen) : stop?.caption}</span>
            )}
          </div>
        )}
      </section>
      {side && (
        <aside className="wside">
          {show('tension') && (
            <div className="wpanel">
              <h3>World tension</h3>
              <div className="wgauge">
                <span className="mono wbig">{w?.level ?? '—'}</span>
                {w && <span className={'cap b-' + w.band}>{BAND_LABEL[w.band]}</span>}
                {w && <small className="wdelta">{(w.change_24h >= 0 ? '+' : '') + w.change_24h} 24h</small>}
              </div>
              <div className="gbar">
                <i style={{ left: (w?.level ?? 0) + '%' }} />
              </div>
            </div>
          )}
          {show('kpis') && (
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
          )}
          {show('weather') && home && (
            <div className="wpanel wweather">
              <h3>Weather · {home.name}</h3>
              {weatherNow?.status === 'ok' && weatherNow.current ? (
                <div className="wwx">
                  <b className="mono">
                    {weatherNow.current.temperature_2m != null ? temperature(weatherNow.current.temperature_2m) : '—'}
                  </b>
                  <span>
                    {weatherNow.high_c != null ? temperature(weatherNow.high_c) : '—'} /{' '}
                    {weatherNow.low_c != null ? temperature(weatherNow.low_c) : '—'}
                    {weatherNow.rain_chance != null ? ' · rain ' + weatherNow.rain_chance + '%' : ''}
                    {weatherNow.current.wind_speed_10m != null
                      ? ' · wind ' + windSpeed(weatherNow.current.wind_speed_10m)
                      : ''}
                  </span>
                </div>
              ) : (
                <span className="quiet">No weather yet.</span>
              )}
              {wx.local.slice(0, 3).map((a) => (
                <span key={a.key} className="wwxalert">
                  {a.event}
                </span>
              ))}
            </div>
          )}
          {show('top') && (
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
          )}
          {show('news') && (
            <div className="wpanel wvideo">
              <LiveFrame channel={channel} audio={audio} />
              <b>{channel.name}</b>
            </div>
          )}
        </aside>
      )}
      {show('ticker') && (
        <footer className="wticker">
          <span className="wlatest">LATEST</span>
          <div className="wtrack">
            <div className="wmove">
              {[...ticker, ...ticker].map((e, i) => (
                <span key={e.id + i} style={{ ['--c' as string]: SEVERITY_COLOR[e.severity] }}>
                  <b className="mono">{SEVERITY_NAME[e.severity].toUpperCase()}</b> {e.title} · {e.place} ·{' '}
                  {ago(e.first_seen)}
                </span>
              ))}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
