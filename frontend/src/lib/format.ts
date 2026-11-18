// Formatting and colour helpers shared by panels and the map.

import type { EventType } from './api';

export const SEVERITY_COLOR: Record<number, string> = {
  1: '#7d93ad',
  2: '#e3c04b',
  3: '#ff9447',
  4: '#ff5260',
  5: '#d61f69',
};

export const SEVERITY_NAME: Record<number, string> = {
  1: 'Info',
  2: 'Elevated',
  3: 'High',
  4: 'Critical',
  5: 'Catastrophic',
};

export const TYPE_INFO: Record<EventType, { label: string; color: string; source: string }> = {
  conflict: { label: 'Armed conflict', color: '#ff5d5d', source: 'GDELT' },
  unrest: { label: 'Civil unrest', color: '#f5b942', source: 'GDELT' },
  quake: { label: 'Earthquakes', color: '#b49cff', source: 'USGS' },
  fire: { label: 'Thermal anomalies', color: '#ff8c42', source: 'NASA FIRMS' },
};

export const EVENT_TYPES = Object.keys(TYPE_INFO) as EventType[];

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const h = Math.floor(mins / 60);
  if (h < 48) return h + 'h ' + (mins % 60) + 'm ago';
  return Math.floor(h / 24) + 'd ago';
}

export function zuluTime(iso: string): string {
  return iso.slice(11, 16) + 'Z';
}

export function latLon(lat: number, lon: number): string {
  return (
    Math.abs(lat).toFixed(4) +
    '°' +
    (lat >= 0 ? 'N' : 'S') +
    ' ' +
    Math.abs(lon).toFixed(4) +
    '°' +
    (lon >= 0 ? 'E' : 'W')
  );
}

export function zoneTime(tz: string, seconds = true): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: seconds ? '2-digit' : undefined,
      hour12: false,
    }).format(new Date());
  } catch {
    return '--:--';
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
