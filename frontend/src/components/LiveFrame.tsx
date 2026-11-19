import { useEffect, useState } from 'react';

import { type Channel, embedUrl } from '../config/newsChannels';
import { getLiveVideo, type LiveVideo } from '../lib/api';

// One channel's current live stream: the API looks up the live video
// (cached server-side), then this embeds it, or says why it can't.
export default function LiveFrame({ channel }: { channel: Channel }) {
  const [live, setLive] = useState<(LiveVideo & { channel: string }) | null>(null);
  const platform = channel.platform ?? 'youtube';

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
          key={ready.video_id}
          src={embedUrl(platform, ready.video_id)}
          title={channel.name + ' live'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="np-msg">
          {!ready
            ? 'Finding the live stream…'
            : ready.status === 'offline'
              ? channel.name + " isn't live right now. Try another channel."
              : "Couldn't reach " + (platform === 'rumble' ? 'Rumble' : 'YouTube') + '. Try again in a minute.'}
        </div>
      )}
    </div>
  );
}
