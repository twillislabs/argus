import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import LiveFrame from '../components/LiveFrame';
import { CHANNELS, channelById } from '../config/newsChannels';

// A news player in its own window (popped out from the map), so it can
// sit on another screen. Pick any channel from the list.
export default function NewsPage() {
  const [params, setParams] = useSearchParams();
  const channel = channelById(params.get('c') ?? CHANNELS[0].id);
  useEffect(() => {
    document.title = channel.name + ' · Argus';
  }, [channel.name]);

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
          {(['US', 'International', 'Business', 'Weather'] as const).map((g) => (
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
