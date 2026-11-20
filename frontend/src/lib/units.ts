// Display units: imperial (the default) or metric, from the user's
// preferences (Settings > Display). Aviation stays in feet and knots and
// ships in knots either way, as on the instruments.

export type Units = 'imperial' | 'metric';

let current: Units = 'imperial';

export function setUnits(units: unknown) {
  current = units === 'metric' ? 'metric' : 'imperial';
}

export const units = () => current;

const KM_MI = 0.621371;
const M_FT = 3.28084;
const MI_M = 1609.344;

function round(n: number): string {
  return Math.round(n).toLocaleString();
}

// A distance given in kilometres: "120 mi" or "193 km".
export function distance(km: number): string {
  if (current === 'metric') return (km < 10 ? km.toFixed(1) : round(km)) + ' km';
  const mi = km * KM_MI;
  return (mi < 10 ? mi.toFixed(1) : round(mi)) + ' mi';
}

// A length or height in metres: "1,200 ft" or "366 m".
export function length(m: number): string {
  return current === 'metric' ? round(m) + ' m' : round(m * M_FT) + ' ft';
}

// A camera altitude in metres: miles or kilometres when high, else feet
// or metres.
export function altitude(m: number): string {
  if (current === 'metric') {
    if (m >= 10_000) return round(m / 1000) + ' km';
    if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
    return round(m) + ' m';
  }
  if (m >= 16 * MI_M) return round(m / MI_M) + ' mi';
  if (m >= MI_M) return (m / MI_M).toFixed(1) + ' mi';
  return round(m * M_FT) + ' ft';
}

// A speed in km/s (satellites): "4.71 mi/s" or "7.58 km/s".
export function speedKms(kms: number): string {
  return current === 'metric' ? kms.toFixed(2) + ' km/s' : (kms * KM_MI).toFixed(2) + ' mi/s';
}

// For the scale bar: a round distance near `metres`, and its length in
// metres. Feet below half a mile in imperial, metres below 1 km in metric.
export function roundDistance(metres: number): { label: string; metres: number } {
  const nice = (x: number) => {
    const pow = 10 ** Math.floor(Math.log10(x));
    return (
      [1, 2, 5]
        .map((n) => n * pow)
        .filter((n) => n <= x)
        .pop() ?? pow
    );
  };
  if (current === 'metric') {
    if (metres >= 1000) {
      const km = nice(metres / 1000);
      return { label: km.toLocaleString() + ' km', metres: km * 1000 };
    }
    const m = nice(metres);
    return { label: m.toLocaleString() + ' m', metres: m };
  }
  if (metres >= MI_M / 2) {
    const mi = nice(metres / MI_M);
    return { label: mi.toLocaleString() + ' mi', metres: mi * MI_M };
  }
  const ft = nice(metres * M_FT);
  return { label: ft.toLocaleString() + ' ft', metres: ft / M_FT };
}

// Temperature from °C: "68°F" or "20°C".
export function temperature(c: number): string {
  return current === 'metric' ? Math.round(c) + '°C' : Math.round((c * 9) / 5 + 32) + '°F';
}

// Wind from km/h: "12 mph" or "19 km/h".
export function windSpeed(kmh: number): string {
  return current === 'metric' ? Math.round(kmh) + ' km/h' : Math.round(kmh * KM_MI) + ' mph';
}

// WMO weather codes (Open-Meteo) in a few words.
export function skyText(code: number | undefined): string {
  if (code === undefined) return '';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

// Precipitation from mm: "0.4 in" or "10 mm".
export function rainfall(mm: number): string {
  if (current === 'metric') return (mm < 10 ? mm.toFixed(1) : Math.round(mm)) + ' mm';
  const inch = mm / 25.4;
  return (inch < 1 ? inch.toFixed(2) : inch.toFixed(1)) + ' in';
}

// Sea-level pressure from hPa: "1013 hPa" or "29.92 inHg".
export function pressure(hpa: number): string {
  return current === 'metric' ? Math.round(hpa) + ' hPa' : (hpa * 0.02953).toFixed(2) + ' inHg';
}
