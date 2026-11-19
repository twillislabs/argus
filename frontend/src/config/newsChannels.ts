// Live news and weather channels for the news overlay. Each plays the
// channel's current live stream through YouTube's own embed
// (embed/live_stream?channel=...), so no API key is needed. IDs were
// checked against each channel's public feed.

export interface Channel {
  id: string;
  name: string;
  short: string;
  group: 'US' | 'International' | 'Business' | 'Weather';
}

export const CHANNELS: Channel[] = [
  { id: 'UCJg9wBPyKMNA5sRDnvzmkdg', name: 'LiveNOW from FOX', short: 'LiveNOW', group: 'US' },
  { id: 'UCXIJgqnII2ZOINSWNOGFThA', name: 'Fox News', short: 'Fox', group: 'US' },
  { id: 'UCx6h-dWzJ5NpAlja1YsApdg', name: 'Newsmax', short: 'Newsmax', group: 'US' },
  { id: 'UCeY0bbntWzzVIaj2z3QigXg', name: 'NBC News', short: 'NBC', group: 'US' },
  { id: 'UC8p1vwvWtl6T73JiExfWs1g', name: 'CBS News', short: 'CBS', group: 'US' },
  { id: 'UCaXkIU1QidjPwiAYu6GcHjg', name: 'MS NOW', short: 'MS NOW', group: 'US' },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'Sky News', short: 'Sky', group: 'International' },
  { id: 'UC0vn8ISa4LKMunLbzaXLnOQ', name: 'GB News', short: 'GB News', group: 'International' },
  { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News', short: 'BBC', group: 'International' },
  { id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', name: 'Al Jazeera English', short: 'Al Jazeera', group: 'International' },
  { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW News', short: 'DW', group: 'International' },
  { id: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', name: 'France 24 English', short: 'France 24', group: 'International' },
  { id: 'UCvHDpsWKADrDia0c99X37vg', name: 'i24NEWS English', short: 'i24', group: 'International' },
  { id: 'UC7fWeaHhqgM4Ry-RMpM2YYw', name: 'TRT World', short: 'TRT', group: 'International' },
  { id: 'UC_gUM8rL-Lrg6O3adPW9K1g', name: 'WION', short: 'WION', group: 'International' },
  { id: 'UCSPEjw8F2nQDtmUKPFNF7_A', name: 'NHK WORLD-JAPAN', short: 'NHK', group: 'International' },
  { id: 'UChqUTb7kYRX8-EiaN3XFrSQ', name: 'Reuters', short: 'Reuters', group: 'Business' },
  { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'Bloomberg Television', short: 'Bloomberg', group: 'Business' },
  { id: 'UCJHAT3Uvv-g3I8H3GhHWV7w', name: "Ryan Hall, Y'all", short: 'Ryan Hall', group: 'Weather' },
];

// The tabs shown by default: a mix of US and international outlets.
export const DEFAULT_TABS = [
  'UCJg9wBPyKMNA5sRDnvzmkdg',
  'UCoMdktPbSTixAyNGwb-UYkQ',
  'UC0vn8ISa4LKMunLbzaXLnOQ',
  'UCNye-wNBqNL5ZzHSJj3l8Bg',
  'UCJHAT3Uvv-g3I8H3GhHWV7w',
];

export function embedUrl(channelId: string): string {
  const p = new URLSearchParams({ channel: channelId, autoplay: '1', mute: '1', playsinline: '1' });
  return 'https://www.youtube-nocookie.com/embed/live_stream?' + p.toString();
}
