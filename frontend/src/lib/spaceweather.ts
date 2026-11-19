// Space weather (/api/spaceweather): NOAA SWPC's R/S/G scales, the
// planetary Kp index and recent alerts.

import { api } from './api';

export interface ScaleNow {
  scale: number;
  text: string;
  name: string;
}

export interface SpaceWeather {
  status: 'ok' | 'stale' | 'error';
  fetched?: string;
  now?: Record<'R' | 'S' | 'G', ScaleNow>;
  forecast?: {
    date: string;
    r_minor_pct: number | null;
    r_major_pct: number | null;
    s_pct: number | null;
    g_scale: number;
  }[];
  kp?: { now: number | null; at: string | null; max_24h: number | null; recent: { at: string; kp: number }[] };
  alerts?: { id: string; issued: string; kind: string; headline: string; message: string }[];
}

export const getSpaceWeather = () => api<SpaceWeather>('/api/spaceweather');

// NOAA's scale colours, 0 (none) to 5 (extreme).
export const SCALE_COLOR = ['#4a5566', '#f3e24d', '#ffb547', '#ff8a3d', '#ff4d4d', '#c0185b'];

// Kp 5 is a G1 storm, 9 a G5.
export const kpColor = (kp: number) => SCALE_COLOR[Math.max(0, Math.min(5, Math.floor(kp) - 4))];
