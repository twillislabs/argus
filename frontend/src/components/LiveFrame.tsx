import { useEffect, useRef, useState } from 'react';

import { type Channel, embedUrl } from '../config/newsChannels';
import { getLiveVideo, type LiveVideo } from '../lib/api';
import { videoPrefs } from '../lib/video';

// One channel's current live stream: the API looks up the live video
// (cached server-side), then this embeds it, or says why it can't.
// audio: the wall's own sound settings; otherwise your video settings.
export default function LiveFrame({
  channel,
  audio,
}: {
  channel: Channel;
  audio?: { muted: boolean; volume: number };
}) {
  const [live, setLive] = useState<(LiveVideo & { channel: string }) | null>(null);
  const platform = channel.platform ?? 'youtube';
  const frame = useRef<HTMLIFrameElement>(null);
  const prefs = audio ?? videoPrefs();
  const loaded = useRef(false);

  // YouTube: set the volume (and unmute) through its player API once the
  // player is ready. Browsers may still start muted until you interact.
  function onLoad() {
    if (platform !== 'youtube') return;
    const win = frame.current?.contentWindow;
    if (!win) return;
    const send = (func: string, args: unknown[] = []) =>
      win.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
    window.setTimeout(() => {
      win.postMessage(JSON.stringify({ event: 'listening' }), 'https://www.youtube-nocookie.com');
      send('setVolume', [prefs.volume]);
      if (!prefs.muted) send('unMute');
      loaded.current = true;
    }, 1500);
  }

  // Sound changed (a wall's settings were pushed): apply it to the
  // playing YouTube player without reloading it.
  useEffect(() => {
    const win = frame.current?.contentWindow;
    if (platform !== 'youtube' || !win || !loaded.current) return;
    const send = (func: string, args: unknown[] = []) =>
      win.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
    send('setVolume', [prefs.volume]);
    send(prefs.muted ? 'mute' : 'unMute');
  }, [platform, prefs.muted, prefs.volume]);

  useEffect(() => {
    let cancelled = false;
    setLive(null);
    getLiveVideo(channel.id, platform)
      .then((v) => {
        if (!cancelled) setLive({ ...v, channel: channel.id });
      })
      .catch(() => {
        if (!cancelled) setLive({ status: 'error', video_id: null, channel: channel.id });
      });
    return () => {
      cancelled = true;
    };
  }, [channel.id, platform]);

  const ready = live?.channel === channel.id ? live : null;
  return (
    <div className="np-video">
      {ready?.video_id ? (
        <iframe
          key={ready.video_id + (platform === 'rumble' ? String(prefs.muted) : '')}
          ref={frame}
          src={embedUrl(platform, ready.video_id, prefs.muted)}
          onLoad={onLoad}
          title={channel.name + ' live'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="np-msg">
          {!ready
            ? 'Finding the live stream…'
            : ready.status === 'upcoming'
              ? channel.name +
                " isn't live right now" +
                (ready.starts_at
                  ? '; its next stream starts ' +
                    new Date(ready.starts_at * 1000).toLocaleString([], {
                      weekday: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : '') +
                '. Try another channel.'
              : ready.status === 'offline'
                ? channel.name + " isn't live right now. Try another channel."
                : "Couldn't reach " + (platform === 'rumble' ? 'Rumble' : 'YouTube') + '. Try again in a minute.'}
        </div>
      )}
    </div>
  );
}
