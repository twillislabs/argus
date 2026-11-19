// How live video starts: the user's own choice (Settings > Display >
// Video), else the server default an admin set, else muted at 50%.

export interface VideoPrefs {
  muted: boolean;
  volume: number;
}

let current: VideoPrefs = { muted: true, volume: 50 };

export function setVideoPrefs(user: unknown, server: unknown) {
  const pick = (v: unknown) => (v && typeof v === 'object' ? (v as Partial<VideoPrefs>) : {});
  const merged = { muted: true, volume: 50, ...pick(server), ...pick(user) };
  current = { muted: merged.muted !== false, volume: Math.max(0, Math.min(100, Number(merged.volume) || 0)) };
}

export const videoPrefs = () => current;
