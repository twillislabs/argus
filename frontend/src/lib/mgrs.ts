// Latitude/longitude to MGRS (Military Grid Reference System) on WGS84,
// for the map's cursor readout. Standard UTM projection, then the 100 km
// square letters; polar areas (UPS) aren't covered and return null.

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';
const SET_COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

function zoneFor(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  // Norway and Svalbard exceptions.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

export function toUtm(lat: number, lon: number): { zone: number; easting: number; northing: number } {
  const zone = zoneFor(lat, lon);
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * Math.cos(phi) ** 2;
  const a = Math.cos(phi) * (lam - lam0);
  const m =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting =
    K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t ** 2 + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000;
  let northing =
    K0 *
    (m +
      n *
        Math.tan(phi) *
        (a ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - 330 * EP2) * a ** 6) / 720));
  if (lat < 0) northing += 10000000;
  return { zone, easting, northing };
}

// "18S UJ 23487 06483" (1 m precision by default).
export function toMgrs(lat: number, lon: number, digits = 5): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat >= 84) return null;
  const { zone, easting, northing } = toUtm(lat, lon);
  const band = BANDS[Math.floor((lat + 80) / 8)];
  const set = (zone - 1) % 3;
  const col = SET_COLS[set][Math.floor(easting / 100000) - 1];
  // Even zones shift the row letters by five.
  const rowIndex = (Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20;
  const row = ROWS[rowIndex];
  if (!col || !row) return null;
  const scale = 10 ** (5 - digits);
  const e = String(Math.floor((easting % 100000) / scale)).padStart(digits, '0');
  const nn = String(Math.floor((northing % 100000) / scale)).padStart(digits, '0');
  return zone + band + ' ' + col + row + ' ' + e + ' ' + nn;
}
