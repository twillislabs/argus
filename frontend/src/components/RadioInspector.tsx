import { useEffect, useRef, useState } from 'react';

import type { RadioStation } from '../lib/api';
import { RADIO_COLOR } from '../map/radioLayer';

// A radio station (Radio Browser): where it is, what it plays, and a
// player. The stream comes straight from the broadcaster, only when you
// press play; it stops when you leave the station.

export default function RadioInspector({ station, onBack }: { station: RadioStation; onBack: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<'stopped' | 'loading' | 'playing' | 'error'>('stopped');
  const [volume, setVolume] = useState(0.8);

  useEffect(() => {
    setState('stopped');
    const el = audio.current;
    return () => {
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    };
  }, [station.id]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  const play = () => {
    const el = audio.current;
    if (!el) return;
    if (state === 'playing' || state === 'loading') {
      el.pause();
      el.removeAttribute('src');
      el.load();
      setState('stopped');
      return;
    }
    setState('loading');
    el.src = station.stream;
    el.play().catch(() => setState('error'));
  };

  const where = [station.state, station.country].filter(Boolean).join(', ');
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">
          <span className="acdot" style={{ background: RADIO_COLOR }} />
          {station.name}
        </h1>
        <div className="sub">{[where, station.language].filter(Boolean).join(' · ')}</div>
        <div className="actions radioplay">
          <button className="btn" onClick={play}>
            {state === 'playing' ? '■ Stop' : state === 'loading' ? '■ Stop (tuning in…)' : '▶ Listen'}
          </button>
          <label className="radiovol">
            <span className="quiet small">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
        </div>
        {state === 'error' && <p className="err small">The station didn&apos;t answer. It may be off the air.</p>}
        <audio
          ref={audio}
          preload="none"
          onPlaying={() => setState('playing')}
          onError={() => audio.current?.getAttribute('src') && setState('error')}
        />
        {station.tags.length > 0 && (
          <div className="badges">
            {station.tags.map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </div>
        )}
        <dl className="kv">
          <div>
            <dt>Stream</dt>
            <dd>
              {[station.codec, station.bitrate ? station.bitrate + ' kbps' : null].filter(Boolean).join(' · ') || '—'}
            </dd>
          </div>
          {station.homepage && (
            <div className="wide">
              <dt>Website</dt>
              <dd>
                <a href={station.homepage} target="_blank" rel="noreferrer">
                  {station.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
                </a>
              </dd>
            </div>
          )}
        </dl>
        <p className="quiet small">
          From Radio Browser, a community directory; the stream plays straight from the broadcaster, only when you press
          Listen. Its place on the map is where the directory puts it.
        </p>
      </section>
    </div>
  );
}
