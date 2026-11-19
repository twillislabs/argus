import { useEffect, useState } from 'react';

import type { VideoAnswer, VideoItem } from '../lib/api';
import { ago } from '../lib/format';

// Videos from a YouTube search (live near the view, or about an event),
// fetched only when asked (the key's daily quota is small), with
// thumbnails and an inline player. Plays through youtube-nocookie.

const STATUS: Record<string, string> = {
  nokey: 'Add a YouTube Data API key in Settings › Data sources to search for video.',
  quota: "YouTube's daily search quota for this server's key is used up; it resets at midnight Pacific time.",
  error: "YouTube didn't answer. Try again in a minute.",
};

export default function VideoList({
  fetch,
  label,
  empty,
  resetKey,
}: {
  fetch: () => Promise<VideoAnswer>;
  label: string;
  empty: string;
  // Changing this (a new view or event) clears the list.
  resetKey: string;
}) {
  const [answer, setAnswer] = useState<VideoAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  useEffect(() => {
    setAnswer(null);
    setPlaying(null);
  }, [resetKey]);

  async function load() {
    setBusy(true);
    try {
      setAnswer(await fetch());
    } catch {
      setAnswer({ status: 'error', items: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vidlist">
      {playing && (
        <div className="vidplayer">
          <iframe
            src={'https://www.youtube-nocookie.com/embed/' + playing.id + '?autoplay=1&mute=1&playsinline=1'}
            title={playing.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          <div className="vidplaying">
            <span>{playing.title}</span>
            <button className="btn small" onClick={() => setPlaying(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      {!answer ? (
        <button className="btn small" disabled={busy} onClick={() => void load()}>
          {busy ? 'Searching…' : label}
        </button>
      ) : answer.status !== 'ok' ? (
        <p className="quiet small">{STATUS[answer.status] ?? STATUS.error}</p>
      ) : answer.items.length === 0 ? (
        <p className="quiet small">{empty}</p>
      ) : (
        <ul className="vids">
          {answer.items.map((v) => (
            <li key={v.id}>
              <button className="vid" onClick={() => setPlaying(v)} title="Play here">
                <img src={v.thumb} alt="" loading="lazy" />
                <span>
                  <b>{v.title}</b>
                  <small>
                    {v.live ? <i className="livetag">LIVE</i> : null} {v.channel}
                    {v.published && !v.live ? ' · ' + ago(v.published) : ''}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {answer && (
        <p className="quiet small">
          From YouTube.{' '}
          <button className="linkbtn" onClick={() => void load()} disabled={busy}>
            Search again
          </button>
        </p>
      )}
    </div>
  );
}
