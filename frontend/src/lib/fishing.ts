// How a Global Fishing Watch event reads in the hover card and its info
// panel (map/fishingLayer.ts draws them).

import type { FishingEvent, FishingVessel } from './api';
import { distance } from './units';
import { FISHING_COLOR, FISHING_LABEL } from '../map/fishingLayer';

const vesselText = (v: FishingVessel | null | undefined) =>
  v
    ? (v.name || (v.mmsi ? 'MMSI ' + v.mmsi : 'Unnamed vessel')) + (v.flag ? ' (' + v.flag + ')' : '')
    : 'Unknown vessel';

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';

const hoursText = (h: number | null | undefined) =>
  h === null || h === undefined ? '' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' days';

export function fishingInfo(e: FishingEvent) {
  const what =
    e.kind === 'encounter'
      ? vesselText(e.vessel) + ' and ' + vesselText(e.other)
      : vesselText(e.vessel) + (e.vessel?.type ? ' · ' + e.vessel.type : '');
  const detail = [
    day(e.start),
    hoursText(e.hours),
    e.kind === 'gap' && e.intentional ? 'likely switched off' : '',
    e.kind === 'gap' && e.distance_km ? distance(e.distance_km) + ' moved while quiet' : '',
    e.shore_km !== null ? distance(e.shore_km) + ' offshore' : '',
    e.eez ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  return { title: FISHING_LABEL[e.kind], color: FISHING_COLOR[e.kind], lines: [what, detail] };
}

export function fishingNote(e: FishingEvent | undefined): string {
  const base = 'From Global Fishing Watch, worked out from AIS over the last 30 days; it runs a few days behind. ';
  if (!e) return base;
  const what = {
    encounter:
      'Two vessels side by side at sea for a while: often a fishing boat handing its catch to a carrier (transshipment), which can hide illegal fishing. Many are routine.',
    loitering:
      'A vessel, often a carrier, moving slowly in one area far from port: it may be waiting to meet others, or just waiting.',
    gap: 'The vessel’s AIS went quiet for a while. Gaps happen out of range of receivers; GFW marks one as likely switched off when the ship was in good coverage.',
  }[e.kind];
  return base + what + ' Indicators, not proof. Powered by Global Fishing Watch.';
}

export function fishingLinks(e: FishingEvent | undefined) {
  const ids = [e?.vessel?.id, e?.other?.id].filter((x): x is string => Boolean(x));
  return [
    ...ids.map((id, i) => ({
      label: (i === 0 ? vesselText(e?.vessel) : vesselText(e?.other)) + ' on GFW',
      url: 'https://globalfishingwatch.org/map/vessel/' + encodeURIComponent(id),
    })),
    { label: 'Global Fishing Watch', url: 'https://globalfishingwatch.org/' },
  ];
}
