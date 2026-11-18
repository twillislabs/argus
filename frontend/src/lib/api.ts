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
