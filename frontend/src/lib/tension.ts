// Words for the tension index (backend argus/tension.py), for people
// meeting it for the first time: the hover card on a country, its info
// panel, and the Situation panel's "What is this?".

import type { TensionCountry } from './api';

export const BAND_RANGE: Record<string, string> = {
  calm: '0–39',
  stable: '40–54',
  moderate: '55–67',
  high: '68–77',
  extreme: '78–100',
};

export const TENSION_EXPLAINER =
  'Tension is a 0–100 score for how much organised violence a country is seeing: wars, armed groups and attacks ' +
  'on civilians. Most of it comes from the last year of deaths counted by UCDP (Uppsala Conflict Data Program): ' +
  'about 10 deaths a year scores 21, 1,000 scores 64, and 50,000 or more scores 100. Confirmed live events in ' +
  'Argus (conflict, unrest and attacks at sea) add up to 20 more, fading over a few days. Bands: calm 0–39, ' +
  'stable 40–54, moderate 55–67, high 68–77, extreme 78–100. The world score is the average of the 40 highest ' +
  'countries. It measures violence, not risk to a traveller: see travel advisories for that.';

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

function yearOnYear(c: TensionCountry): string {
  const p = pct(c.deaths_12m, c.deaths_prev_12m);
  if (p === null) return '';
  if (Math.abs(p) < 5) return ', about the same as the year before';
  return ', ' + (p > 0 ? 'up ' : 'down ') + Math.abs(p) + '% on the year before';
}

function liveText(c: TensionCountry): string {
  const kinds = Object.entries(c.events ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => n + ' ' + (k === 'maritime' ? 'at sea' : k));
  if (c.live <= 0 && !kinds.length) return 'No confirmed live events adding to it now';
  return (
    '+' + Math.round(c.live) + ' from live events' + (kinds.length ? ' (' + kinds.join(', ') + ', last few days)' : '')
  );
}

// The hover card's lines for a country's tint.
export function tensionHover(c: TensionCountry): string[] {
  return [
    'Tension ' + c.level + '/100 · ' + c.band + ' (' + BAND_RANGE[c.band] + ')',
    c.deaths_12m.toLocaleString() + ' deaths from organised violence in a year (UCDP)' + yearOnYear(c),
    liveText(c),
    c.vs_normal !== null
      ? 'Live activity ' + (c.vs_normal >= 0 ? '+' : '') + c.vs_normal + '% against its usual level'
      : '',
    'Click for what the score means',
  ].filter(Boolean);
}

// The info panel's text for a country.
export function tensionNote(c: TensionCountry | undefined): string {
  if (!c) return TENSION_EXPLAINER;
  const parts = [
    c.name + ' scores ' + c.level + ' out of 100 (' + c.band + ').',
    Math.round(c.standing) +
      ' points come from the last year: ' +
      c.deaths_12m.toLocaleString() +
      ' deaths from organised violence counted by UCDP' +
      yearOnYear(c) +
      '.',
    c.live > 0
      ? Math.round(c.live) + ' points come from confirmed live events in Argus, which fade over a few days.'
      : 'No confirmed live events are adding to it right now.',
    c.top?.length ? 'Recent events: ' + c.top.map((t) => t.title).join('; ') + '.' : '',
    TENSION_EXPLAINER,
  ];
  return parts.filter(Boolean).join(' ');
}
