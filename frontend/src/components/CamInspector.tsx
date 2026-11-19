import { useEffect, useState } from 'react';

import type { TrafficCam } from '../lib/api';
import { CAM_COLOR } from '../map/camLayer';

// A traffic camera's latest still, through the API (which fetches it
// from the agency), refreshed every half minute while it's open.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const REFRESH_S = 30;

export default function CamInspector({ cam, onBack }: { cam: TrafficCam; onBack: () => void }) {
  const [tick, setTick] = useState(() => Date.now());
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    setState('loading');
    const id = window.setInterval(() => setTick(Date.now()), REFRESH_S * 1000);
    return () => window.clearInterval(id);
  }, [cam.id]);
  const src = cam.image + '?t=' + Math.floor(tick / 1000);
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
        <figure className="camshot">
          <img
            src={src}
            alt={'Traffic camera: ' + cam.name}
            onLoad={() => {
              setState('ok');
              setLoadedAt(Date.now());
            }}
            onError={() => setState('error')}
          />
          {state === 'error' && <figcaption className="quiet">The camera has no image right now.</figcaption>}
        </figure>
        <p className="quiet small">
          {cam.agency}
          {loadedAt ? ' · refreshed ' + new Date(loadedAt).toLocaleTimeString() : ''} · updates every {REFRESH_S} s
          {cam.video ? ' · the agency also streams live video' : ''}
        </p>
      </section>
    </div>
  );
}
