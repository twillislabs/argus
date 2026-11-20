// Alerts (/api/alert-rules, /api/alerts/*): your own rules, where they're
// delivered (ntfy, a webhook) and what fired (the bell).

import type { Drawing } from '../map/drawTools';
import { api, type Home } from './api';
import { circleRing, rectRing, type LonLat } from './geo';

export type RuleKind = 'events' | 'raids' | 'airport' | 'pattern' | 'watch' | 'space';

export interface Area {
  center?: [number, number];
  radius_km?: number;
  ring?: [number, number][];
  label?: string;
}

export interface AlertRule {
  id: number;
  name: string;
  kind: RuleKind;
  params: Record<string, unknown> & { area?: Area };
  enabled: boolean;
  push: boolean;
  created_at: string;
  last_fired_at: string | null;
}

export interface Channels {
  ntfy_server: string;
  ntfy_topic_hint: string | null;
  webhook_hint: string | null;
  webhook_format: 'json' | 'discord' | 'slack';
  base_url: string;
  quiet_from: string;
  quiet_to: string;
  tz: string;
  default_ntfy: string;
}

export interface FiredAlert {
  id: number;
  rule_id: number;
  title: string;
  body: string;
  link: string | null;
  lat: number | null;
  lon: number | null;
  severity: number;
  created_at: string;
  read: boolean;
  pushed: string | null;
}

export const getRules = () => api<{ rules: AlertRule[] }>('/api/alert-rules');
export const createRule = (r: Omit<AlertRule, 'id' | 'created_at' | 'last_fired_at'>) =>
  api<AlertRule>('/api/alert-rules', { method: 'POST', body: r });
export const saveRule = (r: AlertRule) =>
  api<AlertRule>('/api/alert-rules/' + r.id, {
    method: 'PUT',
    body: { name: r.name, kind: r.kind, params: r.params, enabled: r.enabled, push: r.push },
  });
export const deleteRule = (id: number) => api('/api/alert-rules/' + id, { method: 'DELETE' });

export const getChannels = () => api<Channels>('/api/alerts/channels');
export const putChannels = (body: {
  ntfy_server: string;
  ntfy_topic: string | null;
  webhook_url: string | null;
  webhook_format: Channels['webhook_format'];
  base_url: string;
  quiet_from: string;
  quiet_to: string;
  tz: string;
}) => api<Channels>('/api/alerts/channels', { method: 'PUT', body });
export const testPush = () => api<{ result: string }>('/api/alerts/test', { method: 'POST' });

export const getAlerts = (limit = 30) => api<{ unread: number; alerts: FiredAlert[] }>('/api/alerts?limit=' + limit);
export const markRead = (ids: number[] | 'all') =>
  api('/api/alerts/read', { method: 'POST', body: ids === 'all' ? { all: true } : { ids } });

export const KIND_LABEL: Record<RuleKind, string> = {
  events: 'Events in an area',
  raids: 'Air-raid alerts',
  airport: 'FAA airport status',
  pattern: 'Patterns (orbits, cable loitering)',
  watch: 'Watchlist (aircraft, ships)',
  space: 'Geomagnetic storm',
};

// A home or a drawn shape as a rule's area.
export function homeArea(home: Home): Area {
  return { center: [home.lon, home.lat], radius_km: home.radius_km || 300, label: 'Home (' + home.name + ')' };
}

export function drawingArea(d: Drawing): Area | null {
  const label = (d.kind[0].toUpperCase() + d.kind.slice(1)).replace('-', ' ');
  if (d.kind === 'circle' && d.points[0] && d.radius_km) {
    return { center: [d.points[0][0], d.points[0][1]], radius_km: d.radius_km, label: 'Drawn ' + label };
  }
  let ring: LonLat[] | null = null;
  if (d.kind === 'rectangle' && d.points.length >= 2) ring = rectRing(d.points[0], d.points[1]);
  else if (d.kind === 'polygon' && d.points.length >= 3) ring = d.points;
  if (!ring) return null;
  return { ring: ring.slice(0, 400).map((p) => [p[0], p[1]] as [number, number]), label: 'Drawn ' + label };
}

export const areaLabel = (a?: Area) => (a ? a.label || (a.center ? 'A circle' : 'A drawn area') : 'Anywhere');
export { circleRing };

// A private ntfy topic: hard to guess, since anyone who knows it can read it.
export function newTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'argus-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
