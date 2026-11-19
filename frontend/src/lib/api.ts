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

export type WallLayer = 'tension' | 'events' | 'aircraft' | 'czib' | 'gps' | 'nuclear' | 'cables' | 'bases' | 'sigmet';

// What the wall shows (backend schemas.WallPrefs). Unset: the built-in wall.
export interface WallPrefs {
  news?: boolean;
  channel?: string;
  zones?: { label: string; tz: string }[];
  stops?: WallStop[];
  stop_s?: number;
  interrupt?: boolean;
  layers?: Partial<Record<WallLayer, boolean>>;
}

export const WALL_LAYERS: { id: WallLayer; label: string; on: boolean }[] = [
  { id: 'tension', label: 'Country tension', on: true },
  { id: 'events', label: 'Events', on: true },
  { id: 'aircraft', label: 'Military aircraft', on: true },
  { id: 'czib', label: 'Conflict zone bulletins', on: true },
  { id: 'gps', label: 'GPS interference', on: true },
  { id: 'nuclear', label: 'Nuclear plants', on: true },
  { id: 'cables', label: 'Submarine cables', on: false },
  { id: 'bases', label: 'Military bases', on: false },
  { id: 'sigmet', label: 'SIGMETs', on: false },
];

export const wallLayerOn = (w: WallPrefs | undefined, id: WallLayer): boolean =>
  w?.layers?.[id] ?? WALL_LAYERS.find((l) => l.id === id)?.on ?? false;

export const getScreenWall = (id: number) =>
  api<{ wall: WallPrefs; home: Home | null }>('/api/admin/displays/' + id + '/wall');
export const putScreenWall = (id: number, wall: WallPrefs, home: Home | null) =>
  api<{ wall: WallPrefs; home: Home | null }>('/api/admin/displays/' + id + '/wall', {
    method: 'PUT',
    body: { wall, home },
  });

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
  [key: string]: unknown;
}

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

function csrfToken(): string {
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
  status: 'live' | 'offline' | 'error';
  video_id: string | null;
}
export const getLiveVideo = (channel: string, platform = 'youtube') =>
  api<LiveVideo>('/api/news/live/' + encodeURIComponent(channel) + '?platform=' + platform);

export const getSetupStatus = () =>
  api<{ needs_setup: boolean }>('/api/setup/status');
export const getMe = () => api<Me>('/api/me');
export const logout = () => api<void>('/api/auth/logout', { method: 'POST' });

// --- Milestone 1: events, summary, news, places -----------------------------

export type EventType = 'conflict' | 'unrest' | 'quake' | 'fire' | 'hazard' | 'maritime';

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
  kind: 'coords' | 'aircraft' | 'flight' | 'airport' | 'place' | 'event' | 'filter' | 'satellite' | 'vessel';
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

export async function getSatelliteCatalog() {
  return api<{ updated: string | null; fields: string[]; satellites: (string | number | string[])[][] }>(
    '/api/satellites',
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
