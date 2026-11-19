// FAA airport status (/api/airports/status): ground stops, ground delay
// programs, general delays and closure notices for US airports.

import { api } from './api';

export interface FaaItem {
  kind: 'ground_stop' | 'ground_delay' | 'delay' | 'closure' | 'other';
  reason?: string;
  // Ground stops: end_time. Ground delays: avg, max. Delays: direction,
  // min, max, trend. Closures: start, reopen, partial.
  [field: string]: string | boolean | undefined;
}

export interface FaaStatus {
  updated: string | null;
  airports: Record<string, FaaItem[]>;
  status: 'ok' | 'stale' | 'error';
}

export const getFaaStatus = () => api<FaaStatus>('/api/airports/status');

// How serious an airport's items are, for its ring on the map: a ground
// stop or full closure is 'stop', any delay 'delay'. Notices closing it
// only to some traffic don't count.
export function faaLevel(items: FaaItem[] | undefined): 'stop' | 'delay' | null {
  if (!items?.length) return null;
  if (items.some((i) => i.kind === 'ground_stop' || (i.kind === 'closure' && !i.partial))) return 'stop';
  if (items.some((i) => i.kind === 'ground_delay' || i.kind === 'delay')) return 'delay';
  return null;
}

export const FAA_COLOR = { stop: '#ff5260', delay: '#ffb547' };

const KIND_TITLE: Record<FaaItem['kind'], string> = {
  ground_stop: 'Ground stop',
  ground_delay: 'Ground delay program',
  delay: 'Delays',
  closure: 'Closure notice',
  other: 'Notice',
};

// One line of plain words per item.
export function faaLine(i: FaaItem): { title: string; detail: string } {
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  let detail = '';
  if (i.kind === 'ground_stop') detail = s('end_time') ? 'Until ' + s('end_time') : '';
  else if (i.kind === 'ground_delay')
    detail = [s('avg') && 'average ' + s('avg'), s('max') && 'up to ' + s('max')].filter(Boolean).join(', ');
  else if (i.kind === 'delay')
    detail = [
      s('direction') && s('direction') + 's',
      s('min') && s('max') ? s('min') + ' to ' + s('max') : s('min') || s('max'),
      s('trend') && s('trend').toLowerCase(),
    ]
      .filter(Boolean)
      .join(', ');
  else if (i.kind === 'closure')
    detail = [
      i.partial ? 'Closed to some traffic only' : '',
      s('start') && 'from ' + s('start').replace(/\.$/, ''),
      s('reopen') && 'reopens ' + s('reopen').replace(/\.$/, ''),
    ]
      .filter(Boolean)
      .join(', ');
  return { title: KIND_TITLE[i.kind] ?? 'Notice', detail };
}
