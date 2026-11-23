// Themes: colours, fonts, corners, glow, a screen overlay and a header
// stripe, applied to the whole app as CSS variables on <html> plus a few
// data attributes (styles/themes.css). The built-in themes are below;
// admins add custom ones in Settings › Themes in the same format (the
// server checks every value: backend/argus/themes.py). A custom theme
// starts from a built-in "base" and overrides what it lists.
//
// Which theme shows: your own choice (preference "theme"), else the
// server default (Settings › Defaults), else Argus Dark. Pages shown
// signed out (sign-in, setup, pairing) use the server default from
// /api/theme.

export type FontId =
  'barlow' | 'inter' | 'jetbrains' | 'vt323' | 'plexmono' | 'orbitron' | 'rajdhani' | 'sharetech' | 'exo2';
export type Corners = 'round' | 'square' | 'cut';
export type Overlay = 'none' | 'scanlines' | 'crt' | 'sheen' | 'grid';
export type Stripe = 'none' | 'cassette' | 'neon' | 'line';

export const COLOR_KEYS = [
  'bg',
  'surface',
  'surface2',
  'surface3',
  'line',
  'line2',
  'text',
  'muted',
  'dim',
  'accent',
  'accentText',
  'crit',
  'high',
  'elev',
  'ok',
  'hdrBg',
  'hdrText',
  'hdrMuted',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export const MAP_KEYS = ['ocean', 'land', 'border', 'coast', 'graticule', 'background'] as const;
export type MapKey = (typeof MAP_KEYS)[number];

// What each colour is for (Settings › Themes and the docs).
export const COLOR_HELP: Record<ColorKey, string> = {
  bg: 'Page background',
  surface: 'Panels and cards',
  surface2: 'Raised parts of panels (hover, tiles)',
  surface3: 'Selected and pressed parts',
  line: 'Thin dividers',
  line2: 'Borders of controls',
  text: 'Main text',
  muted: 'Secondary text',
  dim: 'Least important text (sources, hints)',
  accent: 'Accent: links, toggles, selection',
  accentText: 'Text on accent-coloured buttons',
  crit: 'Critical (worst severity)',
  high: 'High severity',
  elev: 'Elevated severity',
  ok: 'Good, healthy',
  hdrBg: 'Header bar background',
  hdrText: 'Header bar text',
  hdrMuted: 'Header bar secondary text',
};
export const MAP_HELP: Record<MapKey, string> = {
  ocean: 'Dark map: sea',
  land: 'Dark map: land',
  border: 'Dark map: country borders',
  coast: 'Dark map: coastlines',
  graticule: 'Dark map: latitude and longitude lines',
  background: 'Space behind the globe',
};

export const FONTS: Record<FontId, { name: string; css: string }> = {
  barlow: { name: 'Barlow Semi Condensed', css: "'Barlow Semi Condensed', 'Arial Narrow', sans-serif" },
  inter: { name: 'Inter', css: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  jetbrains: { name: 'JetBrains Mono', css: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace" },
  vt323: { name: 'VT323 (terminal)', css: "'VT323', ui-monospace, monospace" },
  plexmono: { name: 'IBM Plex Mono', css: "'IBM Plex Mono', ui-monospace, monospace" },
  orbitron: { name: 'Orbitron', css: "'Orbitron', 'Arial Narrow', sans-serif" },
  rajdhani: { name: 'Rajdhani', css: "'Rajdhani', 'Arial Narrow', sans-serif" },
  sharetech: { name: 'Share Tech Mono', css: "'Share Tech Mono', ui-monospace, monospace" },
  exo2: { name: 'Exo 2', css: "'Exo 2', system-ui, sans-serif" },
};

export interface ThemeDef {
  id: string;
  name: string;
  blurb?: string;
  // A custom theme's starting point (a built-in id).
  base?: string;
  colors?: Partial<Record<ColorKey, string>>;
  map?: Partial<Record<MapKey, string>>;
  fonts?: Partial<Record<'head' | 'body' | 'mono', FontId>>;
  corners?: Corners;
  // Corner radius in px (round corners).
  radius?: number;
  // 0 (none) to 1: glow on headings, numbers and the accent.
  glow?: number;
  overlay?: Overlay;
  stripe?: Stripe;
  // Draw the dark map's street tiles light (Daylight).
  lightMap?: boolean;
}

// Every value, so a resolved theme is complete.
export interface Theme extends ThemeDef {
  colors: Record<ColorKey, string>;
  map: Record<MapKey, string>;
  fonts: Record<'head' | 'body' | 'mono', FontId>;
  corners: Corners;
  radius: number;
  glow: number;
  overlay: Overlay;
  stripe: Stripe;
}

const DARK: Theme = {
  id: 'dark',
  name: 'Argus Dark',
  blurb: 'The default: near-black panels, a cool blue accent.',
  colors: {
    bg: '#0b0e13',
    surface: '#10141a',
    surface2: '#151a21',
    surface3: '#1b2129',
    line: '#20262f',
    line2: '#2c343f',
    text: '#d4dae2',
    muted: '#8a94a2',
    dim: '#5b6572',
    accent: '#5b9bff',
    accentText: '#07101f',
    crit: '#ff5260',
    high: '#ff9447',
    elev: '#e3c04b',
    ok: '#4fbf7f',
    hdrBg: 'rgba(0, 0, 0, 0)',
    hdrText: '#d4dae2',
    hdrMuted: '#8a94a2',
  },
  map: {
    ocean: '#0a0f16',
    land: '#171c23',
    border: 'rgba(120, 135, 155, 0.38)',
    coast: 'rgba(120, 140, 170, 0.32)',
    graticule: 'rgba(120, 140, 170, 0.13)',
    background: '#070a0e',
  },
  fonts: { head: 'barlow', body: 'inter', mono: 'jetbrains' },
  corners: 'round',
  radius: 6,
  glow: 0,
  overlay: 'none',
  stripe: 'none',
};

export const BUILTIN_THEMES: ThemeDef[] = [
  DARK,
  {
    id: 'cassette',
    name: 'Cassette Futurism',
    blurb: 'Amber CRT phosphor in beige hardware, with scanlines.',
    colors: {
      bg: '#15110c',
      surface: '#1d170f',
      surface2: '#261e13',
      surface3: '#30261a',
      line: '#3d3020',
      line2: '#6b5434',
      text: '#ffb648',
      muted: '#d99a3c',
      dim: '#b08036',
      accent: '#ff8a1f',
      accentText: '#1a1208',
      crit: '#ff4d2e',
      high: '#ff9a1f',
      elev: '#ffd23f',
      ok: '#a6d65a',
      hdrBg: '#4a3d2b',
      hdrText: '#ffc76a',
      hdrMuted: '#d6a75a',
    },
    map: {
      ocean: '#0d0a06',
      land: '#1f180e',
      border: 'rgba(201, 138, 46, 0.55)',
      coast: 'rgba(255, 182, 72, 0.6)',
      graticule: 'rgba(255, 182, 72, 0.12)',
      background: '#0a0805',
    },
    fonts: { head: 'vt323', body: 'plexmono', mono: 'vt323' },
    corners: 'square',
    radius: 2,
    glow: 0.55,
    overlay: 'crt',
    stripe: 'cassette',
  },
  {
    id: 'cyber',
    name: 'Cyberpunk',
    blurb: 'Neon magenta and cyan, cut corners, warning yellow.',
    colors: {
      bg: '#0a0614',
      surface: '#120a22',
      surface2: '#1c0d34',
      surface3: '#2a1248',
      line: '#3a1d5e',
      line2: '#7a2a8f',
      text: '#f4ecff',
      muted: '#d2b6f5',
      dim: '#a88ccf',
      accent: '#00f0ff',
      accentText: '#0a0614',
      crit: '#ff3864',
      high: '#ff8a00',
      elev: '#fcee0a',
      ok: '#39ff88',
      hdrBg: '#140a28',
      hdrText: '#f4ecff',
      hdrMuted: '#c3a6e8',
    },
    map: {
      ocean: '#06030d',
      land: '#160a24',
      border: 'rgba(255, 47, 208, 0.6)',
      coast: 'rgba(255, 47, 208, 0.75)',
      graticule: 'rgba(0, 240, 255, 0.12)',
      background: '#04020a',
    },
    fonts: { head: 'orbitron', body: 'rajdhani', mono: 'sharetech' },
    corners: 'cut',
    radius: 0,
    glow: 0.7,
    overlay: 'scanlines',
    stripe: 'neon',
  },
  {
    id: 'holo',
    name: 'Hologram',
    blurb: 'Glassy cyan panels floating over the map.',
    colors: {
      bg: '#020e18',
      surface: 'rgba(14, 44, 64, 0.78)',
      surface2: 'rgba(30, 80, 110, 0.45)',
      surface3: 'rgba(60, 140, 180, 0.35)',
      line: 'rgba(125, 249, 255, 0.18)',
      line2: 'rgba(125, 249, 255, 0.4)',
      text: '#e2f9ff',
      muted: '#9fdcf0',
      dim: '#7fbfd8',
      accent: '#7df9ff',
      accentText: '#021320',
      crit: '#ff7a95',
      high: '#ffbd7a',
      elev: '#fff27a',
      ok: '#7dffb2',
      hdrBg: 'rgba(110, 220, 255, 0.06)',
      hdrText: '#e2f9ff',
      hdrMuted: '#9fdcf0',
    },
    map: {
      ocean: '#031424',
      land: '#0b2a3d',
      border: 'rgba(125, 249, 255, 0.45)',
      coast: 'rgba(125, 249, 255, 0.7)',
      graticule: 'rgba(125, 249, 255, 0.12)',
      background: '#00050b',
    },
    fonts: { head: 'exo2', body: 'exo2', mono: 'sharetech' },
    corners: 'round',
    radius: 14,
    glow: 0.6,
    overlay: 'sheen',
    stripe: 'none',
  },
  {
    id: 'vector',
    name: 'Vector',
    blurb: 'Glowing teal lines on black, like an old vector display.',
    colors: {
      bg: '#000000',
      surface: '#000000',
      surface2: '#031210',
      surface3: '#06221e',
      line: '#0e5a55',
      line2: '#19d3c5',
      text: '#b9fff7',
      muted: '#62dccf',
      dim: '#46b3a8',
      accent: '#19ffe4',
      accentText: '#000000',
      crit: '#ff3b6b',
      high: '#ffa630',
      elev: '#f5ff4a',
      ok: '#4dff8c',
      hdrBg: '#000000',
      hdrText: '#19ffe4',
      hdrMuted: '#46b3a8',
    },
    map: {
      ocean: '#000000',
      land: '#000000',
      border: 'rgba(25, 255, 228, 0.55)',
      coast: 'rgba(25, 255, 228, 0.9)',
      graticule: 'rgba(25, 255, 228, 0.18)',
      background: '#000000',
    },
    fonts: { head: 'sharetech', body: 'sharetech', mono: 'sharetech' },
    corners: 'square',
    radius: 0,
    glow: 0.8,
    overlay: 'grid',
    stripe: 'line',
  },
  {
    id: 'nightops',
    name: 'Night Ops',
    blurb: 'All red on black, so eyes stay adjusted to the dark.',
    colors: {
      bg: '#070303',
      surface: '#110606',
      surface2: '#180909',
      surface3: '#220c0b',
      line: '#2a0f0c',
      line2: '#3d1612',
      text: '#ff9f90',
      muted: '#d4766a',
      dim: '#a85a50',
      accent: '#ff5a46',
      accentText: '#070303',
      crit: '#ffd2c8',
      high: '#ff8a76',
      elev: '#d95a48',
      ok: '#8f3a30',
      hdrBg: 'rgba(0, 0, 0, 0)',
      hdrText: '#ff9f90',
      hdrMuted: '#d4766a',
    },
    map: {
      ocean: '#050202',
      land: '#1a0807',
      border: 'rgba(255, 90, 70, 0.35)',
      coast: 'rgba(255, 90, 70, 0.4)',
      graticule: 'rgba(255, 90, 70, 0.1)',
      background: '#030101',
    },
    fonts: { head: 'sharetech', body: 'inter', mono: 'sharetech' },
    corners: 'square',
    radius: 2,
    glow: 0,
    overlay: 'none',
    stripe: 'none',
  },
  {
    id: 'day',
    name: 'Daylight',
    blurb: 'Light panels for bright rooms and screenshots.',
    colors: {
      bg: '#eef1f5',
      surface: '#ffffff',
      surface2: '#f5f7fa',
      surface3: '#e6ebf2',
      line: '#d9dee6',
      line2: '#c2c9d4',
      text: '#18202b',
      muted: '#4d5866',
      dim: '#626d7c',
      accent: '#1f62d6',
      accentText: '#ffffff',
      crit: '#c8202f',
      high: '#b85300',
      elev: '#8a6a00',
      ok: '#1d7f4a',
      hdrBg: '#ffffff',
      hdrText: '#18202b',
      hdrMuted: '#4d5866',
    },
    map: {
      ocean: '#c9d9ea',
      land: '#f3f1ec',
      border: 'rgba(90, 105, 125, 0.45)',
      coast: 'rgba(90, 110, 140, 0.45)',
      graticule: 'rgba(60, 90, 130, 0.12)',
      background: '#dfe6ee',
    },
    fonts: { head: 'barlow', body: 'inter', mono: 'jetbrains' },
    corners: 'round',
    radius: 6,
    glow: 0,
    overlay: 'none',
    stripe: 'none',
    lightMap: true,
  },
];

const byId = (list: ThemeDef[], id: string | null | undefined) => (id ? list.find((t) => t.id === id) : undefined);

// A theme with every value filled in: built-in values for its base (or
// Argus Dark), then its own.
export function resolveTheme(def: ThemeDef | undefined): Theme {
  if (!def) return DARK;
  const base = (byId(BUILTIN_THEMES, def.base ?? def.id) ?? DARK) as Theme;
  const from = base.id === def.id ? DARK : base;
  const pick = <T>(own: T | undefined, b: T | undefined, d: T): T => own ?? b ?? d;
  return {
    ...def,
    colors: { ...DARK.colors, ...from.colors, ...base.colors, ...def.colors },
    map: { ...DARK.map, ...from.map, ...base.map, ...def.map },
    fonts: { ...DARK.fonts, ...from.fonts, ...base.fonts, ...def.fonts },
    corners: pick(def.corners, base.corners, DARK.corners),
    radius: pick(def.radius, base.radius, DARK.radius),
    glow: pick(def.glow, base.glow, DARK.glow),
    overlay: pick(def.overlay, base.overlay, DARK.overlay),
    stripe: pick(def.stripe, base.stripe, DARK.stripe),
    lightMap: def.lightMap ?? base.lightMap ?? false,
  };
}

// All themes someone can pick: built-in, then the server's custom ones.
export function allThemes(custom: ThemeDef[] = []): ThemeDef[] {
  return [...BUILTIN_THEMES, ...custom];
}

// The theme to show: yours, else the server's, else Argus Dark.
export function chooseTheme(custom: ThemeDef[], mine?: string | null, server?: string | null): Theme {
  const list = allThemes(custom);
  return resolveTheme(byId(list, mine) ?? byId(list, server) ?? DARK);
}

const VAR: Record<ColorKey, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  line: '--line',
  line2: '--line-2',
  text: '--text',
  muted: '--muted',
  dim: '--dim',
  accent: '--accent',
  accentText: '--accent-text',
  crit: '--crit',
  high: '--high',
  elev: '--elev',
  ok: '--ok',
  hdrBg: '--hdr-bg',
  hdrText: '--hdr-text',
  hdrMuted: '--hdr-muted',
};

let current: Theme = DARK;
const listeners = new Set<(t: Theme) => void>();

export const currentTheme = () => current;
export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Put a theme on the page: CSS variables on <html> and data attributes
// for the effects (styles/themes.css). Values come from the built-in list
// or a custom theme the server checked, so they're plain colours, known
// font ids and known effect names.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const s = root.style;
  for (const k of COLOR_KEYS) s.setProperty(VAR[k], theme.colors[k]);
  for (const k of MAP_KEYS) s.setProperty('--map-' + k, theme.map[k]);
  s.setProperty('--accent-soft', 'color-mix(in srgb, ' + theme.colors.accent + ' 14%, transparent)');
  s.setProperty('--f-head', FONTS[theme.fonts.head]?.css ?? FONTS.barlow.css);
  s.setProperty('--f-body', FONTS[theme.fonts.body]?.css ?? FONTS.inter.css);
  s.setProperty('--f-mono', FONTS[theme.fonts.mono]?.css ?? FONTS.jetbrains.css);
  const r = theme.corners === 'round' ? Math.max(0, Math.min(24, theme.radius)) : 0;
  s.setProperty('--radius', r + 'px');
  s.setProperty('--radius-s', Math.round(r * 0.66) + 'px');
  const g = Math.max(0, Math.min(1, theme.glow));
  s.setProperty(
    '--glow',
    g > 0
      ? '0 0 ' +
          (3 + 9 * g).toFixed(1) +
          'px color-mix(in srgb, ' +
          theme.colors.accent +
          ' ' +
          Math.round(g * 80) +
          '%, transparent)'
      : 'none',
  );
  s.setProperty(
    '--glow-crit',
    g > 0
      ? '0 0 ' +
          (3 + 9 * g).toFixed(1) +
          'px color-mix(in srgb, ' +
          theme.colors.crit +
          ' ' +
          Math.round(g * 80) +
          '%, transparent)'
      : 'none',
  );
  root.dataset.theme = theme.id;
  root.dataset.corners = theme.corners;
  root.dataset.overlay = theme.overlay;
  root.dataset.stripe = theme.stripe;
  root.dataset.light = theme.lightMap ? 'true' : 'false';
  root.style.colorScheme = theme.lightMap ? 'light' : 'dark';
  current = theme;
  for (const fn of listeners) fn(theme);
}

// Signed-out pages: the server's default theme.
export async function applyServerTheme(): Promise<void> {
  try {
    const r = await fetch('/api/theme', { credentials: 'same-origin' });
    if (!r.ok) return;
    const j = (await r.json()) as { default: string; theme: ThemeDef | null };
    applyTheme(chooseTheme(j.theme ? [j.theme] : [], null, j.default));
  } catch {
    // Offline or blocked: Argus Dark (the stylesheet's own values).
  }
}

// Read a CSS colour from the page (canvas drawing: the sign-in globe).
export function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
