import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import LiveFrame from '../components/LiveFrame';
import { CHANNELS, channelById, channelGroups } from '../config/newsChannels';

// A news player in its own window (popped out from the map), so it can
// sit on another screen. Pick any channel from the list. With ?v= it
// plays one YouTube video instead (popped out from a video list).
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export default function NewsPage() {
  const [params, setParams] = useSearchParams();
  const channel = channelById(params.get('c') ?? CHANNELS[0].id);
  const video = VIDEO_ID.test(params.get('v') ?? '') ? (params.get('v') as string) : null;
  const videoTitle = (params.get('t') ?? '').slice(0, 120) || 'Video';
  useEffect(() => {
    document.title = (video ? videoTitle : channel.name) + ' · Argus';
  }, [channel.name, video, videoTitle]);

  if (video)
    return (
      <div className="newspage">
        <div className="np-head">
          <b className="np-title">{videoTitle}</b>
        </div>
        <iframe
          className="np-video"
          src={'https://www.youtube-nocookie.com/embed/' + video + '?autoplay=1&mute=1&playsinline=1'}
          title={videoTitle}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );

  return (
    <div className="newspage">
      <div className="np-head">
        <span className="np-live">
          <i /> LIVE
        </span>
        <select
          aria-label="Channel"
          value={channel.id}
          onChange={(e) => setParams({ c: e.target.value }, { replace: true })}
        >
          {channelGroups().map((g) => (
            <optgroup key={g} label={g}>
              {CHANNELS.filter((c) => c.group === g).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <LiveFrame channel={channel} />
    </div>
  );
}
