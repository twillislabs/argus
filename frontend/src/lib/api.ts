// Thin fetch wrapper: JSON in and out, CSRF header, readable errors.

export interface User {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: string;
}

export interface Home {
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
  tz: string;
}

export interface Preferences {
  home?: Home;
  basemap?: string;
  show_banner?: boolean;
  left_open?: boolean;
  right_open?: boolean;
  [key: string]: unknown;
}

export interface Me {
  user: User;
  preferences: Preferences;
}

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

export const getSetupStatus = () =>
  api<{ needs_setup: boolean }>('/api/setup/status');
export const getMe = () => api<Me>('/api/me');
export const logout = () => api<void>('/api/auth/logout', { method: 'POST' });

// --- Milestone 1: events, summary, news, places -----------------------------

export type EventType = 'conflict' | 'unrest' | 'quake' | 'fire';

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
  kind: 'coords' | 'aircraft' | 'flight' | 'airport' | 'place' | 'event' | 'filter';
  label: string;
  detail: string;
  lat?: number;
  lon?: number;
  height_m?: number;
  hex?: string;
  mil?: boolean;
  id?: string;
  callsign?: string;
  filter?: { events?: EventType[]; aircraft?: string };
}

export const search = (q: string) =>
  api<{ query: string; results: SearchResult[] }>('/api/search?q=' + encodeURIComponent(q));
