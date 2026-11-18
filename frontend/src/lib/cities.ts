// Offline city list for the home-location picker. Place search through a
// geocoder (Photon / Nominatim) replaces this in a later milestone.

export interface City {
  name: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
}

const RAW: [string, string, number, number, string][] = [
  ['Nashville', 'United States', 36.16, -86.78, 'America/Chicago'],
  ['Knoxville', 'United States', 35.96, -83.92, 'America/New_York'],
  ['Memphis', 'United States', 35.15, -90.05, 'America/Chicago'],
  ['Chattanooga', 'United States', 35.05, -85.31, 'America/New_York'],
  ['Washington, DC', 'United States', 38.91, -77.04, 'America/New_York'],
  ['New York', 'United States', 40.71, -74.0, 'America/New_York'],
  ['Boston', 'United States', 42.36, -71.06, 'America/New_York'],
  ['Atlanta', 'United States', 33.75, -84.39, 'America/New_York'],
  ['Miami', 'United States', 25.76, -80.19, 'America/New_York'],
  ['Chicago', 'United States', 41.88, -87.63, 'America/Chicago'],
  ['St. Louis', 'United States', 38.63, -90.2, 'America/Chicago'],
  ['Minneapolis', 'United States', 44.98, -93.27, 'America/Chicago'],
  ['Kansas City', 'United States', 39.1, -94.58, 'America/Chicago'],
  ['Dallas', 'United States', 32.78, -96.8, 'America/Chicago'],
  ['Houston', 'United States', 29.76, -95.37, 'America/Chicago'],
  ['San Antonio', 'United States', 29.42, -98.49, 'America/Chicago'],
  ['Denver', 'United States', 39.74, -104.99, 'America/Denver'],
  ['Salt Lake City', 'United States', 40.76, -111.89, 'America/Denver'],
  ['Phoenix', 'United States', 33.45, -112.07, 'America/Phoenix'],
  ['Los Angeles', 'United States', 34.05, -118.24, 'America/Los_Angeles'],
  ['San Francisco', 'United States', 37.77, -122.42, 'America/Los_Angeles'],
  ['Seattle', 'United States', 47.61, -122.33, 'America/Los_Angeles'],
  ['Anchorage', 'United States', 61.22, -149.9, 'America/Anchorage'],
  ['Honolulu', 'United States', 21.31, -157.86, 'Pacific/Honolulu'],
  ['Toronto', 'Canada', 43.65, -79.38, 'America/Toronto'],
  ['Vancouver', 'Canada', 49.28, -123.12, 'America/Vancouver'],
  ['Mexico City', 'Mexico', 19.43, -99.13, 'America/Mexico_City'],
  ['Bogotá', 'Colombia', 4.71, -74.07, 'America/Bogota'],
  ['São Paulo', 'Brazil', -23.55, -46.63, 'America/Sao_Paulo'],
  ['Buenos Aires', 'Argentina', -34.6, -58.38, 'America/Argentina/Buenos_Aires'],
  ['London', 'United Kingdom', 51.51, -0.13, 'Europe/London'],
  ['Dublin', 'Ireland', 53.35, -6.26, 'Europe/Dublin'],
  ['Paris', 'France', 48.86, 2.35, 'Europe/Paris'],
  ['Madrid', 'Spain', 40.42, -3.7, 'Europe/Madrid'],
  ['Berlin', 'Germany', 52.52, 13.4, 'Europe/Berlin'],
  ['Amsterdam', 'Netherlands', 52.37, 4.9, 'Europe/Amsterdam'],
  ['Rome', 'Italy', 41.9, 12.5, 'Europe/Rome'],
  ['Warsaw', 'Poland', 52.23, 21.01, 'Europe/Warsaw'],
  ['Stockholm', 'Sweden', 59.33, 18.07, 'Europe/Stockholm'],
  ['Helsinki', 'Finland', 60.17, 24.94, 'Europe/Helsinki'],
  ['Kyiv', 'Ukraine', 50.45, 30.52, 'Europe/Kyiv'],
  ['Bucharest', 'Romania', 44.43, 26.1, 'Europe/Bucharest'],
  ['Istanbul', 'Turkey', 41.01, 28.98, 'Europe/Istanbul'],
  ['Tel Aviv', 'Israel', 32.09, 34.78, 'Asia/Jerusalem'],
  ['Cairo', 'Egypt', 30.04, 31.24, 'Africa/Cairo'],
  ['Riyadh', 'Saudi Arabia', 24.71, 46.68, 'Asia/Riyadh'],
  ['Dubai', 'UAE', 25.2, 55.27, 'Asia/Dubai'],
  ['Nairobi', 'Kenya', -1.29, 36.82, 'Africa/Nairobi'],
  ['Lagos', 'Nigeria', 6.52, 3.38, 'Africa/Lagos'],
  ['Johannesburg', 'South Africa', -26.2, 28.05, 'Africa/Johannesburg'],
  ['New Delhi', 'India', 28.61, 77.21, 'Asia/Kolkata'],
  ['Singapore', 'Singapore', 1.35, 103.82, 'Asia/Singapore'],
  ['Bangkok', 'Thailand', 13.76, 100.5, 'Asia/Bangkok'],
  ['Hong Kong', 'China', 22.32, 114.17, 'Asia/Hong_Kong'],
  ['Taipei', 'Taiwan', 25.03, 121.56, 'Asia/Taipei'],
  ['Seoul', 'South Korea', 37.57, 126.98, 'Asia/Seoul'],
  ['Tokyo', 'Japan', 35.69, 139.69, 'Asia/Tokyo'],
  ['Manila', 'Philippines', 14.6, 120.98, 'Asia/Manila'],
  ['Sydney', 'Australia', -33.87, 151.21, 'Australia/Sydney'],
  ['Perth', 'Australia', -31.95, 115.86, 'Australia/Perth'],
  ['Auckland', 'New Zealand', -36.85, 174.76, 'Pacific/Auckland'],
];

export const CITIES: City[] = RAW.map(([name, country, lat, lon, tz]) => ({
  name,
  country,
  lat,
  lon,
  tz,
}));

function distance(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(h));
}

export function nearestTimeZone(lat: number, lon: number): string {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = distance(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.tz;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
