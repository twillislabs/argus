import { useEffect, useState } from 'react';

import type { VideoAnswer, VideoItem } from '../lib/api';
import { ago } from '../lib/format';

// Videos from a search (live near the view: YouTube with a key and
// Dailymotion without; or YouTube video about an event), fetched only
// when asked (YouTube's daily quota is small), with thumbnails and an
// inline player. YouTube plays through youtube-nocookie.
// Argus pages send no referrer to other sites (nginx), but YouTube's
// player refuses to start without one (error 153), so the frame asks for
// the origin only. Any video can pop out into its own window (/news?v=).

export function popOutVideo(v: { id: string; title: string }) {
  const q = new URLSearchParams({ v: v.id, t: v.title.slice(0, 120) });
  window.open('/news?' + q.toString(), 'argus-video-' + v.id, 'popup,width=960,height=600');
}

const STATUS: Record<string, string> = {
  nokey: 'Nothing found. Add a YouTube Data API key in Settings › Data sources to search YouTube too.',
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
            src={
              playing.platform === 'dailymotion'
                ? 'https://geo.dailymotion.com/player.html?video=' +
                  encodeURIComponent(playing.id) +
                  '&autoplay=1&mute=true'
                : 'https://www.youtube-nocookie.com/embed/' + playing.id + '?autoplay=1&mute=1&playsinline=1'
            }
            title={playing.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <div className="vidplaying">
            <span>{playing.title}</span>
            {playing.platform !== 'dailymotion' && (
              <button
                className="btn small"
                title="Open in its own window"
                onClick={() => {
                  popOutVideo(playing);
                  setPlaying(null);
                }}
              >
                Pop out ⧉
              </button>
            )}
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
                    {v.platform === 'dailymotion' ? ' · Dailymotion' : ''}
                    {v.where ? ' · ' + v.where : ''}
                    {v.published && !v.live ? ' · ' + ago(v.published) : ''}
                  </small>
                </span>
              </button>
              {v.platform !== 'dailymotion' && (
                <button
                  className="vidpop"
                  title="Open in its own window"
                  aria-label={'Pop out ' + v.title}
                  onClick={() => popOutVideo(v)}
                >
                  ⧉
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {answer && (
        <p className="quiet small">
          {answer.sources ? 'From YouTube and Dailymotion.' : 'From YouTube.'}{' '}
          <button className="linkbtn" onClick={() => void load()} disabled={busy}>
            Search again
          </button>
        </p>
      )}
    </div>
  );
}
