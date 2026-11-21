// How a behaviour pattern reads in the Situation panel, the hover card
// and the aircraft and ship inspectors.

import type { AirPattern, SeaPattern } from './api';
import { distance } from './units';

export const airPatternTitle = (p: AirPattern) => (p.kind === 'racetrack' ? 'Racetrack' : 'Orbit');

export const airPatternLine = (p: AirPattern) =>
  p.laps +
  ' laps in ' +
  p.minutes +
  ' min, ' +
  distance(p.radius_km * 2) +
  ' across' +
  (p.near ? ' · near ' + p.near : '');

export const seaPatternTitle = 'Loitering on a cable';

export const seaPatternLine = (p: SeaPattern) =>
  p.hours + ' h within 3 km, ' + distance(p.cable_km) + ' from ' + p.cable + (p.status ? ' · ' + p.status : '');
