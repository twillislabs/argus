// Live news and weather channels for the news overlay. The API looks up
// each channel's current live video (/api/news/live/<channel>) and the
// player embeds that video; YouTube no longer plays
// embed/live_stream?channel=... IDs were checked against each channel's
// public feed.

export interface Channel {
  // A YouTube channel ID, or the Rumble channel name for Rumble.
  id: string;
  name: string;
  short: string;
  group: 'US' | 'International' | 'Business' | 'Weather';
  platform?: 'youtube' | 'rumble';
}

export const CHANNELS: Channel[] = [
  { id: 'UCJg9wBPyKMNA5sRDnvzmkdg', name: 'LiveNOW from FOX', short: 'LiveNOW', group: 'US' },
  { id: 'UCXIJgqnII2ZOINSWNOGFThA', name: 'Fox News', short: 'Fox', group: 'US' },
  { id: 'UCx6h-dWzJ5NpAlja1YsApdg', name: 'Newsmax', short: 'Newsmax', group: 'US' },
  { id: 'UCeY0bbntWzzVIaj2z3QigXg', name: 'NBC News', short: 'NBC', group: 'US' },
  { id: 'UC8p1vwvWtl6T73JiExfWs1g', name: 'CBS News', short: 'CBS', group: 'US' },
  { id: 'UCaXkIU1QidjPwiAYu6GcHjg', name: 'MS NOW', short: 'MS NOW', group: 'US' },
  { id: 'UCBi2mrWuNuyYy4gbM6fU18Q', name: 'ABC News', short: 'ABC', group: 'US' },
  { id: 'UCCjG8NtOig0USdrT5D1FpxQ', name: 'NewsNation', short: 'NewsNation', group: 'US' },
  // Not on YouTube: the live show streams on Rumble.
  { id: 'TheAlexJonesShowLive', name: 'Alex Jones Live', short: 'Alex Jones', group: 'US', platform: 'rumble' },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'Sky News', short: 'Sky', group: 'International' },
  { id: 'UC0vn8ISa4LKMunLbzaXLnOQ', name: 'GB News', short: 'GB News', group: 'International' },
  // Sky News Australia, renamed News24 in 2026 (same channel).
  { id: 'UCO0akufu9MOzyz3nvGIXAAw', name: 'News24 (Sky News Australia)', short: 'News24 AU', group: 'International' },
  { id: 'UCSrZ3UV4jOidv8ppoVuvW9Q', name: 'Euronews', short: 'Euronews', group: 'International' },
  { id: 'UC83jt4dlz1Gjl58fzQrrKZg', name: 'CNA', short: 'CNA', group: 'International' },
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
  { id: 'UC1FbPiXx59_ltnFVx7IxWow', name: 'FOX Weather', short: 'FOX Weather', group: 'Weather' },
];

// The tabs shown by default: a mix of US and international outlets.
export const DEFAULT_TABS = [
  'UCJg9wBPyKMNA5sRDnvzmkdg',
  'UCoMdktPbSTixAyNGwb-UYkQ',
  'UC0vn8ISa4LKMunLbzaXLnOQ',
  'UCNye-wNBqNL5ZzHSJj3l8Bg',
  'UCJHAT3Uvv-g3I8H3GhHWV7w',
];

export function embedUrl(platform: Channel['platform'], videoId: string, muted = true): string {
  if (platform === 'rumble') {
    // autoplay=2 starts muted (browsers allow that); 1 starts with sound.
    return 'https://rumble.com/embed/' + encodeURIComponent(videoId) + '/?autoplay=' + (muted ? '2' : '1');
  }
  // enablejsapi lets LiveFrame set the volume once the player loads.
  const p = new URLSearchParams({
    autoplay: '1',
    mute: muted ? '1' : '0',
    playsinline: '1',
    enablejsapi: '1',
    origin: window.location.origin,
  });
  return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) + '?' + p.toString();
}

export const channelById = (id: string): Channel => CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];
