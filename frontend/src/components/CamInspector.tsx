import { useEffect, useRef, useState } from 'react';

import { getCamVideo, type TrafficCam } from '../lib/api';
import { CAM_COLOR } from '../map/camLayer';

// A traffic camera's latest still, through the API (which fetches it
// from the agency), refreshed every half minute while it's open. Where
// the agency streams live video (HLS) or keeps a short clip (MP4), Play
// shows it; video comes straight from the agency, only on request.

type Hls = { loadSource: (u: string) => void; attachMedia: (v: HTMLVideoElement) => void; destroy: () => void };

function Player({ cam }: { cam: TrafficCam }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let hls: Hls | null = null;
    let stopped = false;
    void (async () => {
      try {
        const v = await getCamVideo(cam.id);
        const el = video.current;
        if (stopped || !el) return;
        if (v.kind === 'clip') {
          el.src = v.url;
        } else {
          // hls.js wherever the browser has Media Source Extensions; some
          // browsers claim native HLS they can't really play. Native only
          // where hls.js can't run (iPhone Safari).
          const H = (await import('hls.js')).default;
          if (H.isSupported()) {
            hls = new H({ maxBufferLength: 10 }) as unknown as Hls;
            hls.loadSource(v.url);
            hls.attachMedia(el);
          } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
            el.src = v.url;
          } else {
            throw new Error("This browser can't play live streams.");
          }
        }
        void el.play().catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The video could not be played.');
      }
    })();
    return () => {
      stopped = true;
      hls?.destroy();
    };
  }, [cam.id]);
  return (
    <>
      <video ref={video} className="camvideo" controls muted playsInline loop={cam.video === 'clip'} />
      {error && <p className="quiet small">{error}</p>}
    </>
  );
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const REFRESH_S = 30;

export default function CamInspector({
  cam,
  onBack,
  onLookAlong,
}: {
  cam: TrafficCam;
  onBack: () => void;
  // Fly to just behind the camera, where its picture faces you.
  onLookAlong?: () => void;
}) {
  const [tick, setTick] = useState(() => Date.now());
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // Video starts by itself where the camera has it (live or a clip).
  const [playing, setPlaying] = useState(cam.video !== null);
  useEffect(() => {
    setState('loading');
    setPlaying(cam.video !== null);
    const id = window.setInterval(() => setTick(Date.now()), REFRESH_S * 1000);
    return () => window.clearInterval(id);
  }, [cam.id]);
  const src = cam.image ? cam.image + '?t=' + Math.floor(tick / 1000) : null;
  // A camera with no still (DelDOT's) always shows its video.
  const showVideo = playing || !src;
  const facing = cam.direction !== null ? COMPASS[Math.round(cam.direction / 45) % 8] : null;
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">
          <span className="acdot" style={{ background: CAM_COLOR }} />
          {cam.name}
        </h1>
        <div className="sub">
          {[cam.road, cam.place, facing ? 'looking ' + facing : null].filter(Boolean).join(' · ')}
        </div>
        {showVideo ? (
          <Player cam={cam} />
        ) : (
          <figure className="camshot">
            <img
              src={src ?? undefined}
              alt={'Traffic camera: ' + cam.name}
              onLoad={() => {
                setState('ok');
                setLoadedAt(Date.now());
              }}
              onError={() => setState('error')}
            />
            {state === 'error' && <figcaption className="quiet">The camera has no image right now.</figcaption>}
          </figure>
        )}
        {(cam.video || (onLookAlong && cam.direction !== null)) && (
          <div className="actions">
            {cam.video && src && (
              <button className="btn small" onClick={() => setPlaying(!playing)}>
                {playing ? 'Back to the still' : cam.video === 'live' ? '▶ Play live video' : '▶ Play latest clip'}
              </button>
            )}
            {onLookAlong && cam.direction !== null && (
              <button
                className="btn small"
                onClick={onLookAlong}
                title="Fly to just behind the camera: its picture stands at the end of its view on the map"
              >
                View along it
              </button>
            )}
          </div>
        )}
        <p className="quiet small">
          {cam.agency}
          {loadedAt ? ' · refreshed ' + new Date(loadedAt).toLocaleTimeString() : ''} · updates every {REFRESH_S} s
          {showVideo ? ' · video plays straight from ' + cam.agency : ''}
        </p>
      </section>
    </div>
  );
}
