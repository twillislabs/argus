import { useState } from 'react';

import type { Webcam } from '../lib/api';
import { WEBCAM_COLOR } from '../map/camLayer';

// A Windy webcam: its daylight timelapse (Windy's player, playing in the
// panel), its latest still (linked to its Windy page, as Windy's terms
// ask), and a link to its live stream on Windy where it has one: Windy's
// API doesn't give stream URLs, its "live" player only links out.
export default function WebcamInspector({ cam, onBack }: { cam: Webcam; onBack: () => void }) {
  // The timelapse opens straight away; the still is a click back.
  const [player, setPlayer] = useState(Boolean(cam.player));
  const [broken, setBroken] = useState(false);
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">
          <span className="acdot" style={{ background: WEBCAM_COLOR }} />
          {cam.title}
        </h1>
        {cam.place && <div className="sub">{cam.place}</div>}
        {player && cam.player ? (
          <iframe className="camplayer" src={cam.player} title={'Timelapse: ' + cam.title} allowFullScreen />
        ) : (
          <figure className="camshot">
            {cam.image && !broken ? (
              <a href={cam.page ?? 'https://www.windy.com/'} target="_blank" rel="noreferrer noopener">
                <img src={cam.image} alt={'Webcam: ' + cam.title} onError={() => setBroken(true)} />
              </a>
            ) : (
              <figcaption className="quiet">No preview right now.</figcaption>
            )}
          </figure>
        )}
        <div className="actions">
          {cam.player && (
            <button className="btn small" onClick={() => setPlayer(!player)}>
              {player ? 'Back to the still' : '▶ Timelapse'}
            </button>
          )}
          {cam.live && (
            <a className="btn small" href={cam.live} target="_blank" rel="noreferrer noopener">
              Live on Windy ↗
            </a>
          )}
          {cam.page && (
            <a className="btn small" href={cam.page} target="_blank" rel="noreferrer noopener">
              Windy page ↗
            </a>
          )}
        </div>
        <p className="quiet small">
          Webcams provided by{' '}
          <a href="https://www.windy.com/" target="_blank" rel="noreferrer noopener">
            windy.com
          </a>
          {cam.updated ? ' · updated ' + new Date(cam.updated).toLocaleString() : ''}
        </p>
      </section>
    </div>
  );
}
