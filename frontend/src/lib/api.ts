// Thin fetch wrapper: JSON in and out, CSRF header, readable errors.

export interface User {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: Role;
  must_change_password: boolean;
  capabilities: string[];
}

export type Role = 'admin' | 'analyst' | 'viewer' | 'display';

export const can = (user: User, capability: string) => user.capabilities.includes(capability);

export interface Home {
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
  tz: string;
}

// A wall screen's tour stop: home, every theatre (most tense first), one
// theatre, or a place.
export interface WallStop {
  kind: 'home' | 'theatres' | 'theatre' | 'place';
  key?: string;
  name?: string;
  lat?: number;
  lon?: number;
  height?: number;
}

export type WallLayer =
  | 'tension'
  | 'events'
  | 'aircraft'
  | 'czib'
  | 'gps'
  | 'nuclear'
  | 'power'
  | 'cables'
  | 'bases'
  | 'sigmet'
  | 'tfr'
  | 'ships'
  | 'wx_alerts'
  | 'wx_zones'
  | 'wx_outlook'
  | 'clouds'
  | 'precip'
  | 'stations'
  | 'advisories'
  | 'wiki';

export type WallSection = 'header' | 'clocks' | 'tension' | 'kpis' | 'top' | 'news' | 'weather' | 'caption' | 'ticker';

// What the wall shows (backend schemas.WallPrefs). Unset: the built-in wall.
export interface WallPrefs {
  news?: boolean;
  channel?: string;
  // 'tv': live TV fills the screen (tv_channels: one, or a grid of up to 4).
  mode?: 'map' | 'tv';
  tv_channels?: string[];
  // The live TV's sound (only the first channel plays sound in a grid).
  muted?: boolean;
  volume?: number;
  zones?: { label: string; tz: string }[];
  stops?: WallStop[];
  stop_s?: number;
  interrupt?: boolean;
  layers?: Partial<Record<WallLayer, boolean>>;
  sections?: Partial<Record<WallSection, boolean>>;
}

export const WALL_LAYERS: { id: WallLayer; label: string; on: boolean; group: string }[] = [
  { id: 'events', label: 'Events', on: true, group: 'Events' },
  { id: 'tension', label: 'Country tension', on: true, group: 'Events' },
  { id: 'wiki', label: 'Wikipedia events', on: false, group: 'Events' },
  { id: 'aircraft', label: 'Military aircraft', on: true, group: 'Air and sea' },
  { id: 'ships', label: 'Ships', on: false, group: 'Air and sea' },
  { id: 'czib', label: 'Conflict zone bulletins', on: true, group: 'Airspace' },
  { id: 'gps', label: 'GPS interference', on: true, group: 'Airspace' },
  { id: 'sigmet', label: 'SIGMETs', on: false, group: 'Airspace' },
  { id: 'tfr', label: 'Flight restrictions (TFRs)', on: false, group: 'Airspace' },
  { id: 'wx_alerts', label: 'Storm warnings (NWS)', on: false, group: 'Weather' },
  { id: 'wx_zones', label: 'Watches and advisories (NWS)', on: false, group: 'Weather' },
  { id: 'wx_outlook', label: 'Severe weather outlook (SPC)', on: false, group: 'Weather' },
  { id: 'clouds', label: 'Clouds (infrared)', on: false, group: 'Weather' },
  { id: 'precip', label: 'Precipitation', on: false, group: 'Weather' },
  { id: 'nuclear', label: 'Nuclear plants', on: true, group: 'Infrastructure' },
  { id: 'power', label: 'Power plants', on: false, group: 'Infrastructure' },
  { id: 'cables', label: 'Submarine cables', on: false, group: 'Infrastructure' },
  { id: 'bases', label: 'Military bases', on: false, group: 'Infrastructure' },
  { id: 'stations', label: 'Space stations (ISS)', on: true, group: 'Other' },
  { id: 'advisories', label: 'Travel advisories', on: false, group: 'Other' },
];

export const WALL_SECTIONS: { id: WallSection; label: string; on: boolean; hint: string }[] = [
  { id: 'header', label: 'Title bar', on: true, hint: 'Argus · Watch floor, and the classification line' },
  { id: 'clocks', label: 'Clocks', on: true, hint: 'UTC, home and any extra clocks' },
  { id: 'caption', label: 'Tour caption', on: true, hint: 'Where the map is, and the next stop' },
  { id: 'tension', label: 'World tension', on: true, hint: 'The gauge' },
  { id: 'kpis', label: 'Counts', on: true, hint: 'Events, aircraft, critical events, GPS cells' },
  { id: 'top', label: 'Top events', on: true, hint: 'The five most severe' },
  { id: 'weather', label: 'Weather at home', on: false, hint: 'Conditions and NWS alerts for the home' },
  { id: 'news', label: 'Live news', on: true, hint: 'A live channel' },
  { id: 'ticker', label: 'Ticker', on: true, hint: 'The latest events along the bottom' },
];

export const wallSectionOn = (w: WallPrefs | undefined, id: WallSection): boolean =>
  id === 'news' && w?.news === false
    ? false
    : (w?.sections?.[id] ?? WALL_SECTIONS.find((x) => x.id === id)?.on ?? true);

// Named wall setups screens follow (Settings > Displays).
export interface WallProfile {
  id: string;
  name: string;
  wall: WallPrefs;
  screens?: number;
}
export const getWallProfiles = () => api<{ profiles: WallProfile[] }>('/api/admin/wall-profiles');
export const createWallProfile = (name: string, wall: WallPrefs) =>
  api<WallProfile>('/api/admin/wall-profiles', { method: 'POST', body: { name, wall } });
export const saveWallProfile = (id: string, name: string, wall: WallPrefs) =>
  api<WallProfile>('/api/admin/wall-profiles/' + id, { method: 'PUT', body: { name, wall } });
export const deleteWallProfile = (id: string) => api('/api/admin/wall-profiles/' + id, { method: 'DELETE' });
export const getWallProfile = (id: string) => api<WallProfile>('/api/wall-profiles/' + encodeURIComponent(id));

export const wallLayerOn = (w: WallPrefs | undefined, id: WallLayer): boolean =>
  w?.layers?.[id] ?? WALL_LAYERS.find((l) => l.id === id)?.on ?? false;

// Pushing changes to screens now (Settings > Displays).
export const getWallSync = () => api<{ boot: string; sync: number; reload: number }>('/api/display/sync');
export const syncScreens = (reload: boolean, id?: number) =>
  api('/api/admin/displays/' + (id !== undefined ? id + '/' : '') + 'sync', { method: 'POST', body: { reload } });

export const getScreenWall = (id: number) =>
  api<{ wall: WallPrefs; home: Home | null; profile: string | null }>('/api/admin/displays/' + id + '/wall');
export const putScreenWall = (id: number, wall: WallPrefs, home: Home | null, profile: string | null = null) =>
  api<{ wall: WallPrefs; home: Home | null; profile: string | null }>('/api/admin/displays/' + id + '/wall', {
    method: 'PUT',
    body: { wall, home, profile },
  });

// Air-raid alerts (/api/raids). Ukraine: every oblast (active or not);
// Israel: localities alerted now or in the last 24 hours.
export interface RaidAlert {
  id: string;
  name: string;
  lat: number;
  lon: number;
  active: boolean;
  since?: string | null; // Ukraine: when the state last changed
  long_running?: boolean; // Ukraine: a continuous alert (occupied areas)
  threat?: number; // Israel
  threat_label?: string;
  time?: string; // Israel: when it sounded
}
export interface Raids {
  ukraine: RaidAlert[];
  israel: RaidAlert[];
  ukraine_status?: string;
  israel_status?: string;
  attribution?: string;
}
export const getRaids = () => api<Raids>('/api/raids');

// Behaviour patterns (/api/patterns): military orbits and racetracks,
// ships loitering near submarine cables.
export interface AirPattern {
  kind: 'orbit' | 'racetrack';
  hex: string;
  callsign: string | null;
  type: string | null;
  role: string | null;
  lat: number;
  lon: number;
  radius_km: number;
  laps: number;
  minutes: number;
  alt_ft: number | null;
  near: string | null;
}
export interface SeaPattern {
  kind: 'loiter_cable';
  mmsi: number;
  name: string | null;
  status: string | null;
  lat: number;
  lon: number;
  hours: number;
  cable: string;
  cable_km: number;
  near: string | null;
}
export interface Patterns {
  air: AirPattern[];
  sea: SeaPattern[];
}
export const getPatterns = () => api<Patterns>('/api/patterns');

// Cyber (/api/cyber): IODA internet outages, ransomware.live counts per
// country (no victim names), CISA's newest exploited vulnerabilities.
export interface InternetOutage {
  cc: string;
  country: string | null;
  start: string;
  end: string;
  ongoing: boolean;
  source: string;
  score: number;
}
export interface RansomwareCountry {
  cc: string;
  country: string;
  lat: number;
  lon: number;
  count: number;
  // When the source's recent list starts (it holds the latest 100).
  since: string | null;
  latest: string;
  sectors: string[];
  groups: string[];
}
export interface ExploitedVuln {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  added: string | null;
  due: string | null;
  ransomware: boolean;
  description: string;
}
export interface Cyber {
  outages: InternetOutage[];
  outages_fetched: string | null;
  ransomware: RansomwareCountry[];
  ransomware_fetched: string | null;
  kev: ExploitedVuln[];
  kev_fetched: string | null;
}
export const getCyber = () => api<Cyber>('/api/cyber');

// Rocket launches (/api/launches): the last three days and next two
// weeks, from Launch Library 2.
export interface Launch {
  id: string;
  name: string;
  net: string | null;
  precision: string | null;
  window_start: string | null;
  window_end: string | null;
  status: string;
  status_name: string | null;
  provider: string | null;
  rocket: string | null;
  mission: string | null;
  description: string | null;
  mission_type: string | null;
  orbit: string | null;
  pad: string | null;
  location: string | null;
  country: string | null;
  pad_wiki: string | null;
  lat: number;
  lon: number;
  probability: number | null;
  webcast_live: boolean;
}
export const getLaunches = () =>
  api<{ fetched: string | null; items: Launch[]; attribution: string }>('/api/launches');

// Wikipedia's Current events (/api/wikipedia), newest first.
export interface WikiItem {
  id: string;
  date: string;
  category: string;
  topics: string[];
  text: string;
  links: string[];
  sources: { name: string; url: string }[];
  lat: number | null;
  lon: number | null;
  place: string;
  url: string;
}

export const getWikipedia = () =>
  api<{ fetched: string | null; items: WikiItem[]; attribution: string }>('/api/wikipedia');

// Travel advisories (/api/advisories), per Natural Earth country name.
export interface Advisory {
  country: string;
  level: number;
  us: { level: number; label: string; title: string; summary: string; updated: string | null; url: string } | null;
  uk: { level: number; label: string; change: string; updated: string | null; url: string } | null;
}

export const getAdvisories = () =>
  api<{ fetched: string | null; countries: Advisory[]; attribution: string }>('/api/advisories');

export interface Preferences {
  home?: Home;
  basemap?: string;
  show_banner?: boolean;
  left_open?: boolean;
  right_open?: boolean;
  units?: 'imperial' | 'metric';
  drawings?: unknown[];
  show_route?: boolean;
  wall?: WallPrefs;
  video?: { muted: boolean; volume: number };
  brief?: BriefPrefs;
  [key: string]: unknown;
}

// The Brief's sections (schemas.BRIEF_SECTIONS), in their default order.
export const BRIEF_SECTIONS = [
  { id: 'us_stories', label: 'US top stories' },
  { id: 'us_events', label: 'US events' },
  { id: 'theatres', label: 'Theatres' },
  { id: 'digest', label: 'AI digest' },
  { id: 'world_stories', label: 'World top stories' },
  { id: 'world_events', label: 'World events' },
  { id: 'changes', label: 'Changes since yesterday' },
  { id: 'wiki', label: 'Wikipedia current events' },
  { id: 'tension', label: 'Tension by country' },
  { id: 'kev', label: 'Exploited vulnerabilities' },
  { id: 'space', label: 'Space weather' },
  { id: 'sources', label: 'Source health' },
] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number]['id'];
export interface BriefPrefs {
  order: BriefSection[];
  hidden: BriefSection[];
}

// The saved order, with sections added since appended in their default
// place, and the hidden ones taken out.
export function briefLayout(p: BriefPrefs | undefined): {
  order: BriefSection[];
  shown: BriefSection[];
  hidden: BriefSection[];
} {
  const all = BRIEF_SECTIONS.map((s) => s.id) as BriefSection[];
  const order = (p?.order ?? []).filter((s) => all.includes(s));
  for (const s of all) if (!order.includes(s)) order.splice(Math.min(all.indexOf(s), order.length), 0, s);
  const hidden = (p?.hidden ?? []).filter((s) => all.includes(s));
  return { order, shown: order.filter((s) => !hidden.includes(s)), hidden };
}

export interface Story {
  title: string;
  url: string;
  outlet: string;
  outlets: string[];
  outlet_count: number;
  latest: string;
  articles: { outlet: string; title: string; url: string; published_at: string }[];
}
export const getStories = () => api<{ us: Story[]; world: Story[] }>('/api/stories');

// Server-wide defaults an admin sets (Settings > Defaults).
export interface ServerDefaults {
  layers?: Record<string, unknown>;
  news?: { tabs: string[] };
  video?: { muted: boolean; volume: number };
}

export interface Me {
  user: User;
  preferences: Preferences;
  defaults?: ServerDefaults;
}

export const getDefaults = () => api<ServerDefaults>('/api/admin/defaults');
export const putDefaults = (body: ServerDefaults) => api<ServerDefaults>('/api/admin/defaults', { method: 'PUT', body });

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function csrfToken(): string {
  const hit = document.cookie
    .split('; ')
    .find((c) => c.startsWith('argus_csrf='));
  return hit ? decodeURIComponent(hit.slice('argus_csrf='.length)) : '';
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { loc?: string[]; msg?: string };
      const field = first.loc ? first.loc[first.loc.length - 1] : '';
      return (field ? field + ': ' : '') + (first.msg ?? 'Invalid value');
    }
  }
  if (status >= 500) return 'The server had a problem. Try again shortly.';
  return 'Request failed (' + status + ').';
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  const res = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error page (for example from a proxy).
    }
    throw new ApiError(res.status, messageFrom(body, res.status));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LiveVideo {
  // upcoming: the channel's next stream is scheduled, not on air yet.
  status: 'live' | 'offline' | 'upcoming' | 'error';
  video_id: string | null;
  starts_at?: number | null; // Unix seconds, for upcoming
}
export const getLiveVideo = (channel: string, platform = 'youtube') =>
  api<LiveVideo>('/api/news/live/' + encodeURIComponent(channel) + '?platform=' + platform);

export const getSetupStatus = () =>
  api<{ needs_setup: boolean }>('/api/setup/status');
export const getMe = () => api<Me>('/api/me');
export const logout = () => api<void>('/api/auth/logout', { method: 'POST' });

// --- Milestone 1: events, summary, news, places -----------------------------

export type EventType = 'conflict' | 'unrest' | 'incident' | 'quake' | 'fire' | 'hazard' | 'maritime';

export interface EventItem {
  id: string;
  type: EventType;
  severity: number;
  severity_name: string;
  status: 'active' | 'candidate' | 'expired';
  title: string;
  summary: string;
  place: string;
  country: string;
  lat: number;
  lon: number;
  first_seen: string;
  last_updated: string;
  confidence: number;
  source_count: number;
  article_count: number;
  data: Record<string, unknown>;
}

export interface Article {
  id: number;
  outlet: string;
  url: string;
  title: string;
  summary: string;
  published_at: string;
}

export interface SourceStatus {
  name: string;
  label: string;
  enabled: boolean;
  interval_s: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_count: number;
}

export interface Summary {
  hours: number;
  total: number;
  by_type: Partial<Record<EventType, number>>;
  by_severity: Record<string, number>;
  latest: EventItem[];
  top: EventItem[];
  news: Article[];
  sources: SourceStatus[];
}

export interface EventDetail {
  event: EventItem;
  sources: {
    source: string;
    observed_at: string;
    url: string | null;
    label: string;
    articles: number | null;
    external_id: string;
    // GDELT records: does the link name the place, and was it coded as
    // the same kind of event?
    check?: { place: 'named' | 'not_named' | 'unknown'; same_kind: boolean };
  }[];
  articles: Article[];
}

export interface Place {
  name: string;
  label: string;
  region: string;
  country: string;
  cc: string;
  lat: number;
  lon: number;
  population: number;
  tz: string;
}

export interface EventQuery {
  hours?: number;
  candidates?: boolean;
  minSeverity?: number;
}

export function getEvents(q: EventQuery = {}) {
  const params = new URLSearchParams({
    hours: String(q.hours ?? 24),
    min_severity: String(q.minSeverity ?? 1),
    candidates: String(Boolean(q.candidates)),
  });
  return api<{ events: EventItem[] }>('/api/events?' + params.toString());
}

export const getEvent = (id: string) =>
  api<EventDetail>('/api/events/' + encodeURIComponent(id));
export const getSummary = () => api<Summary>('/api/summary');
export const searchPlaces = (q: string) =>
  api<{ places: Place[] }>('/api/places?q=' + encodeURIComponent(q));
export const nearestPlace = (lat: number, lon: number) =>
  api<{ place: { name: string; label: string; tz: string } | null }>(
    '/api/places/nearest?lat=' + lat + '&lon=' + lon,
  );
export const savePreferences = (prefs: Partial<Preferences> & Record<string, unknown>) =>
  api<Me>('/api/me/preferences', { method: 'PATCH', body: prefs });

// --- Milestone 2: aircraft and universal search -----------------------------

export interface Aircraft {
  hex: string;
  callsign: string;
  reg: string;
  type: string;
  mil: boolean;
  role: string | null;
  lat: number;
  lon: number;
  alt_ft: number | null;
  ground: boolean;
  gs_kt: number | null;
  track: number | null;
  vrate: number | null;
  squawk: string | null;
  emergency: boolean;
  seen: number | null;
  // ADS-B emitter category (A1 light ... A5 heavy, A7 rotorcraft).
  category?: string | null;
  // The feed it came from: adsb.lol, adsb.fi, or your own receiver.
  source?: string;
  // When the position was observed, unix seconds.
  seen_at?: number;
}

export interface RouteAirport {
  iata: string | null;
  icao: string | null;
  name: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

export interface AircraftDetail {
  aircraft: Aircraft;
  detail: {
    type: string | null;
    icao_type: string | null;
    manufacturer: string | null;
    registration: string | null;
    country: string | null;
  } | null;
  route: {
    callsign: string;
    flight: string | null;
    airline: string | null;
    origin: RouteAirport | null;
    destination: RouteAirport | null;
  } | null;
  progress: { total_km: number; remaining_km: number; fraction: number; plausible: boolean } | null;
  // [lon, lat, alt_ft, unix seconds]
  trail: number[][];
}

export type CivilStatus = 'ok' | 'zoom' | 'off' | 'error' | 'limited';

export type Bbox = [number, number, number, number];

export function getAircraft(bbox: Bbox | null, civil: boolean) {
  const params = new URLSearchParams({ civil: String(civil) });
  if (bbox) params.set('bbox', bbox.map((v) => v.toFixed(3)).join(','));
  return api<{ aircraft: Aircraft[]; civil_status: CivilStatus; updated: number }>(
    '/api/aircraft?' + params.toString(),
  );
}

export const getAircraftDetail = (hex: string) =>
  api<AircraftDetail>('/api/aircraft/' + encodeURIComponent(hex));

export interface SearchResult {
  kind:
    | 'coords'
    | 'aircraft'
    | 'flight'
    | 'airport'
    | 'place'
    | 'event'
    | 'filter'
    | 'satellite'
    | 'vessel'
    // An address from Nominatim (/api/geocode), and the "Find address"
    // entry that asks for one.
    | 'address'
    | 'lookup';
  label: string;
  detail: string;
  lat?: number;
  lon?: number;
  height_m?: number;
  hex?: string;
  mil?: boolean;
  id?: string;
  callsign?: string;
  norad?: number;
  mmsi?: number;
  filter?: { events?: EventType[]; aircraft?: string };
}

export const search = (q: string) =>
  api<{ query: string; results: SearchResult[] }>('/api/search?q=' + encodeURIComponent(q));

// Addresses (OpenStreetMap Nominatim): only when asked, never as you type.
export const findAddress = (q: string) =>
  api<{ results: SearchResult[]; attribution: string }>('/api/geocode?q=' + encodeURIComponent(q));

// --- Server-wide imagery (admins set it; every user's map uses it) ----------

export interface MapConfig {
  imagery: { provider: 'esri' | 'google'; google_key: string | null; google_3d: boolean };
}

export interface ImagerySettings {
  provider: 'esri' | 'google';
  google_key_set: boolean;
  google_key_hint: string | null;
  google_key_unreadable: boolean;
  google_3d: boolean;
}

export const getMapConfig = () => api<MapConfig>('/api/map/config');
export const getImagerySettings = () => api<ImagerySettings>('/api/admin/imagery');
export const saveImagerySettings = (body: {
  provider: 'esri' | 'google';
  google_key?: string;
  google_3d: boolean;
}) => api<ImagerySettings>('/api/admin/imagery', { method: 'PUT', body });

// --- Users and accounts ------------------------------------------------------

export interface AdminUser extends User {
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  locked_until: string | null;
}

export const ROLE_INFO: Record<Role, { label: string; detail: string }> = {
  admin: { label: 'Administrator', detail: 'Everything, including users and server settings' },
  analyst: { label: 'Analyst', detail: 'The map and analyst tools (alerts, notes, AI as they arrive)' },
  viewer: { label: 'Viewer', detail: 'The map, read-only' },
  display: { label: 'Display', detail: 'A wall screen: read-only, never idles out, managed by admins' },
};

export const listUsers = () => api<AdminUser[]>('/api/admin/users');
export const createUser = (body: { username: string; display_name: string; email?: string; role: Role }) =>
  api<{ user: AdminUser; temporary_password: string }>('/api/admin/users', { method: 'POST', body });
export const updateUser = (
  id: number,
  body: Partial<{ display_name: string; email: string | null; role: Role; is_active: boolean }>,
) => api<AdminUser>('/api/admin/users/' + id, { method: 'PATCH', body });
export const resetUserPassword = (id: number) =>
  api<{ temporary_password: string }>('/api/admin/users/' + id + '/reset-password', { method: 'POST' });
export const unlockUser = (id: number) => api<AdminUser>('/api/admin/users/' + id + '/unlock', { method: 'POST' });
export const deleteUser = (id: number) => api<void>('/api/admin/users/' + id, { method: 'DELETE' });
export const changePassword = (current_password: string, new_password: string) =>
  api<void>('/api/me/password', { method: 'POST', body: { current_password, new_password } });
export const updateProfile = (body: { display_name?: string; email?: string | null }) =>
  api<User>('/api/me/profile', { method: 'PATCH', body });

// --- Satellites --------------------------------------------------------------

export interface SatelliteDetail {
  norad: number;
  name: string;
  cospar: string;
  class: 'leo' | 'meo' | 'geo' | 'heo';
  tags: string[];
  epoch: string;
  orbit: { period_min: number; apogee_km: number; perigee_km: number; inclination: number };
}

export const getSatellite = (norad: number) => api<SatelliteDetail>('/api/satellites/' + norad);

// tag: only satellites with it ('station': the crewed stations, a few
// objects), for the Space stations layer on its own.
export async function getSatelliteCatalog(tag?: string) {
  return api<{ updated: string | null; fields: string[]; satellites: (string | number | string[])[][] }>(
    '/api/satellites' + (tag ? '?tag=' + encodeURIComponent(tag) : ''),
  );
}

// --- Vessels and data source keys --------------------------------------------

export type VesselCategory = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'military' | 'other';

export interface Vessel {
  mmsi: number;
  name: string | null;
  callsign: string | null;
  imo: number | null;
  flag: string | null;
  ship_type: number | null;
  type: string | null;
  category: VesselCategory;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  status: string | null;
  // Serious OpenSanctions flags (sanction, mare.shadow, poi), in lists.
  sanctions?: string[];
  // Every listing, on the single-vessel answer.
  sanctions_listings?: { name: string; risks: string[]; labels: string[]; datasets: string[]; flag: string; url: string | null }[];
  sanctions_attribution?: string;
  destination: string | null;
  eta: string | null;
  draught: number | null;
  length: number | null;
  beam: number | null;
  age_s: number | null;
}

export type SeaStatus = 'ok' | 'nokey' | 'waiting';

export function getVessels(bbox: Bbox | null) {
  const params = new URLSearchParams();
  if (bbox) params.set('bbox', bbox.map((v) => v.toFixed(3)).join(','));
  return api<{ vessels: Vessel[]; total: number; status: SeaStatus }>('/api/vessels?' + params.toString());
}

export const getVessel = (mmsi: number) => api<Vessel>('/api/vessels/' + mmsi);

export interface KeyState {
  purpose: string;
  set: boolean;
  hint: string | null;
  unreadable: boolean;
}

export const getKeys = () => api<Record<string, KeyState>>('/api/admin/keys');
export const saveKeys = (body: Record<string, string>) =>
  api<Record<string, KeyState>>('/api/admin/keys', { method: 'PUT', body });

// --- Airspace ----------------------------------------------------------------

export interface AirspaceItem {
  key: string;
  kind: 'tfr' | 'sigmet' | 'czib' | 'structure';
  id: string;
  title: string;
  hazard: string | null;
  area: string | null;
  countries: string[] | null;
  valid_from: string | null;
  valid_to: string | null;
  base_ft: number | null;
  top_ft: number | null;
  facility: string | null;
  polygon: [number, number][] | null;
  raw: string | null;
  url: string | null;
  lat: number | null;
  lon: number | null;
  lower?: string | null;
  upper?: string | null;
}

// YouTube search results (/api/video/...), with an admin's key.
export interface VideoItem {
  id: string;
  title: string;
  channel: string;
  published: string | null;
  live: boolean;
  thumb: string;
  url: string;
}
export interface VideoAnswer {
  status: 'ok' | 'nokey' | 'quota' | 'error' | 'zoom';
  items: VideoItem[];
}
export const getLiveNear = (lat: number, lon: number, radiusKm: number) =>
  api<VideoAnswer>(
    '/api/video/near?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4) + '&radius_km=' + Math.round(radiusKm),
  );
export const getEventVideo = (id: string) => api<VideoAnswer>('/api/video/event/' + encodeURIComponent(id));

// Windy webcams in view (/api/webcams), with an admin's key.
export interface Webcam {
  id: string;
  title: string;
  place: string | null;
  lat: number;
  lon: number;
  status: string | null;
  image: string | null;
  player: string | null;
  // Windy's live player: a still linking to its stream page, opened in a
  // new tab.
  live?: string | null;
  page: string | null;
  updated: string | null;
}
export const getWebcams = (bbox: Bbox) =>
  api<{ status: VideoAnswer['status']; items: Webcam[]; attribution?: string }>(
    '/api/webcams?bbox=' + bbox.map((v) => v.toFixed(3)).join(','),
  );

// Government traffic cameras (/api/cams), for a regional view. image is
// our proxy path; agency URLs never reach the browser.
export interface TrafficCam {
  id: string;
  name: string;
  road: string | null;
  place: string | null;
  direction: number | null;
  lat: number;
  lon: number;
  agency: string;
  refresh_s: number;
  image: string;
  // Live video (HLS) or a short recent clip (MP4), from the agency.
  video: 'live' | 'clip' | null;
}

export const getCamVideo = (id: string) =>
  api<{ kind: 'live' | 'clip'; url: string }>('/api/cams/' + encodeURIComponent(id) + '/video');

export const getCams = (bbox: Bbox) =>
  api<{ cameras: TrafficCam[]; status: 'ok' | 'zoom' }>('/api/cams?bbox=' + bbox.map((v) => v.toFixed(3)).join(','));

// ALPR cameras mapped in OpenStreetMap (/api/alpr), for a regional view.
export interface AlprCamera {
  id: string;
  lat: number;
  lon: number;
  vendor: string;
  operator: string | null;
  direction: number | null;
  zone: string | null;
  mapped: string | null;
  osm_url: string;
  deflock_url: string;
  directions?: number[];
  operator_type?: string | null;
  mount?: string | null;
  model?: string | null;
  tags?: Record<string, string>;
}
export type AlprStatus = 'ok' | 'partial' | 'zoom';

export const getAlpr = (bbox: Bbox) =>
  api<{ cameras: AlprCamera[]; status: AlprStatus }>('/api/alpr?bbox=' + bbox.map((v) => v.toFixed(3)).join(','));

export function getAirspaceStructure(bbox: Bbox) {
  return api<{ items: AirspaceItem[]; status: 'ok' | 'zoom' | 'nokey' | 'blocked' | 'error' }>(
    '/api/airspace/structure?bbox=' + bbox.map((v) => v.toFixed(3)).join(','),
  );
}

export const getAirspace = () => api<{ items: AirspaceItem[] }>('/api/airspace');

export interface GpsCell {
  id: string;
  // Centre and radius (degrees of latitude) of the hexagon.
  lat: number;
  lon: number;
  r: number;
  aircraft: number;
  bad: number;
  share: number;
  level: 'low' | 'medium' | 'high';
}

export const getGps = () => api<{ cells: GpsCell[]; window_s: number }>('/api/gps');

export const getReceivers = () => api<{ adsb_url: string | null; ais_url: string | null }>('/api/admin/receivers');
export const saveReceivers = (body: { adsb_url: string; ais_url: string }) =>
  api<{ adsb_url: string | null; ais_url: string | null }>('/api/admin/receivers', { method: 'PUT', body });

export interface TensionArea {
  key: string;
  name: string;
  level: number;
  band: 'calm' | 'stable' | 'moderate' | 'high' | 'extreme';
  change_24h: number;
  top: { id: string; title: string; type: string; severity: number; status: string; weight: number }[];
}
export interface TensionCountry extends TensionArea {
  // Points from UCDP deaths over 12 months, and from live events.
  standing: number;
  live: number;
  raw: number;
  deaths_12m: number;
  deaths_prev_12m: number;
  // Live activity against its 90-day average (%), once there's history.
  vs_normal: number | null;
  events: Record<string, number>;
  theatre: string | null;
}
export interface TensionTheatre extends TensionArea {
  bbox: [number, number, number, number];
  countries: string[];
}
export interface Tension {
  updated: string;
  baseline_days: number;
  baseline_ready: boolean;
  ucdp_through: string;
  world: TensionArea & { vs_normal: number | null };
  theatres: TensionTheatre[];
  countries: TensionCountry[];
}
export const getTension = () => api<Tension>('/api/tension');

// --- Weather ---------------------------------------------------------------

export interface WxAlert {
  key: string;
  event: string;
  headline: string;
  severity: number;
  urgency: string | null;
  area: string;
  sender: string | null;
  onset: string | null;
  expires: string | null;
  description: string;
  instruction: string;
  polygons: number[][][];
  url: string;
  lat: number | null;
  lon: number | null;
}
export interface OutlookArea {
  key: string;
  day: number;
  label: string;
  level: number;
  name: string;
  title: string;
  fill: string | null;
  valid_from: string | null;
  valid_to: string | null;
  polygons: number[][][];
  url: string;
}
export interface WeatherNow {
  status: 'ok' | 'error';
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    wind_direction_10m?: number;
    cloud_cover?: number;
    precipitation?: number;
    weather_code?: number;
  };
  high_c?: number | null;
  low_c?: number | null;
  rain_chance?: number | null;
}
export const getWxAlerts = (home: { lat: number; lon: number } | null, zones = false) => {
  const p = new URLSearchParams();
  if (home) {
    p.set('lat', home.lat.toFixed(4));
    p.set('lon', home.lon.toFixed(4));
  }
  if (zones) p.set('zones', '1');
  return api<{ alerts: WxAlert[]; zoned: WxAlert[]; local: WxAlert[] }>('/api/weather/alerts?' + p.toString());
};
export const getOutlook = () => api<{ areas: OutlookArea[] }>('/api/weather/outlook');
export const getWeatherNow = (lat: number, lon: number) =>
  api<WeatherNow>('/api/weather/now?lat=' + lat.toFixed(2) + '&lon=' + lon.toFixed(2));
