import { useState } from 'react';

import { MAX_SHOTS, MAX_TOURS, newShot, newTourId, type Tour, type TourShot, tourLink } from '../lib/tours';

// Director mode (toolbar > Tours): build a tour from map views, each
// with a caption, a flight time and a hold time; play it, save it to
// your account, or share it as a link. Playback runs in MapPage.

interface Props {
  tours: Tour[];
  // A tour opened from a link, not saved yet.
  shared: Tour | null;
  activeId: string | null;
  playing: { id: string; index: number } | null;
  onActive: (id: string | null) => void;
  onTours: (tours: Tour[]) => void;
  onSaveShared: () => void;
  currentCamera: () => string | null;
  onGo: (shot: TourShot) => void;
  onPlay: (tour: Tour, from: number) => void;
  onStop: () => void;
  onClose: () => void;
}

export default function TourPanel(p: Props) {
  const [note, setNote] = useState('');
  const all = p.shared ? [p.shared, ...p.tours] : p.tours;
  const tour = all.find((t) => t.id === p.activeId) ?? null;
  const isShared = tour !== null && tour === p.shared;
  const playingHere = p.playing && tour && p.playing.id === tour.id ? p.playing.index : null;

  // Saved tours change through onTours (MapPage saves them); a shared one
  // is read-only until saved.
  const update = (next: Tour) => p.onTours(p.tours.map((t) => (t.id === next.id ? next : t)));
  const setShot = (i: number, patch: Partial<TourShot>) =>
    tour && update({ ...tour, shots: tour.shots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  function create() {
    if (p.tours.length >= MAX_TOURS) return setNote('You can keep up to ' + MAX_TOURS + ' tours.');
    const cam = p.currentCamera();
    const t: Tour = {
      id: newTourId(),
      name: 'Tour ' + (p.tours.length + 1),
      loop: false,
      shots: cam ? [newShot(cam)] : [],
    };
    p.onTours([...p.tours, t]);
    p.onActive(t.id);
    setNote('');
  }

  function addShot() {
    const cam = p.currentCamera();
    if (!tour || !cam) return;
    if (tour.shots.length >= MAX_SHOTS) return setNote('A tour holds up to ' + MAX_SHOTS + ' shots.');
    update({ ...tour, shots: [...tour.shots, newShot(cam)] });
  }

  function move(i: number, d: number) {
    if (!tour) return;
    const shots = [...tour.shots];
    const j = i + d;
    if (j < 0 || j >= shots.length) return;
    [shots[i], shots[j]] = [shots[j], shots[i]];
    update({ ...tour, shots });
  }

  async function share() {
    if (!tour) return;
    const link = tourLink(tour);
    try {
      await navigator.clipboard.writeText(link);
      setNote('Link copied. Anyone signed in to this Argus can open it to play the tour.');
    } catch {
      window.prompt('Copy this link', link);
    }
  }

  return (
    <div className="inspector-body tours">
      <div className="isec tight">
        <button className="backlink" onClick={p.onClose}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: '#c39bff' }}>
            Director
          </span>
        </div>
        <h1 className="etitle">Tours</h1>
        <div className="sub">
          Saved camera moves with captions, for briefings and screens. Frame a view on the map, then add it as a shot.
        </div>
        <div className="field">
          <label htmlFor="tour-pick">Tour</label>
          <div className="pairform">
            <select id="tour-pick" value={p.activeId ?? ''} onChange={(e) => p.onActive(e.target.value || null)}>
              <option value="">Choose a tour…</option>
              {all.map((t) => (
                <option key={t.id} value={t.id}>
                  {t === p.shared ? 'Shared: ' : ''}
                  {t.name} ({t.shots.length})
                </option>
              ))}
            </select>
            <button className="btn small" onClick={create}>
              New tour
            </button>
          </div>
        </div>
        {note && <p className="quiet small">{note}</p>}
      </section>
      {tour && (
        <>
          <section className="isec">
            {isShared ? (
              <p className="small">
                <b>{tour.name}</b>, opened from a link.{' '}
                <button className="btn small" onClick={p.onSaveShared}>
                  Save to my tours
                </button>
              </p>
            ) : (
              <div className="field">
                <label htmlFor="tour-name">Name</label>
                <input
                  id="tour-name"
                  value={tour.name}
                  maxLength={60}
                  onChange={(e) => update({ ...tour, name: e.target.value || 'Tour' })}
                />
              </div>
            )}
            <div className="actions">
              {playingHere !== null ? (
                <button className="btn primary" onClick={p.onStop}>
                  ■ Stop
                </button>
              ) : (
                <button className="btn primary" disabled={!tour.shots.length} onClick={() => p.onPlay(tour, 0)}>
                  ▶ Play
                </button>
              )}
              {!isShared && (
                <label className="check small">
                  <input
                    type="checkbox"
                    checked={tour.loop}
                    onChange={(e) => update({ ...tour, loop: e.target.checked })}
                  />
                  Loop
                </label>
              )}
              <button className="btn small" disabled={!tour.shots.length} onClick={() => void share()}>
                Share link
              </button>
              {!isShared && (
                <button
                  className="btn small"
                  onClick={() => {
                    if (!window.confirm('Delete the tour "' + tour.name + '"?')) return;
                    p.onTours(p.tours.filter((t) => t.id !== tour.id));
                    p.onActive(null);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </section>
          <section className="isec">
            <h3>Shots · {tour.shots.length}</h3>
            <ol className="shotlist">
              {tour.shots.map((s, i) => (
                <li key={i} className={playingHere === i ? 'on' : undefined}>
                  <div className="shothead">
                    <b className="mono">{i + 1}</b>
                    <input
                      aria-label={'Caption for shot ' + (i + 1)}
                      placeholder="Caption (optional)"
                      value={s.caption}
                      maxLength={200}
                      readOnly={isShared}
                      onChange={(e) => setShot(i, { caption: e.target.value })}
                    />
                  </div>
                  <div className="shotrow">
                    <label>
                      Fly{' '}
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={s.fly_s}
                        readOnly={isShared}
                        onChange={(e) => setShot(i, { fly_s: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                      />
                      s
                    </label>
                    <label>
                      Hold{' '}
                      <input
                        type="number"
                        min={1}
                        max={600}
                        value={s.hold_s}
                        readOnly={isShared}
                        onChange={(e) =>
                          setShot(i, { hold_s: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })
                        }
                      />
                      s
                    </label>
                    <span className="rowbtns">
                      <button className="btn small" title="Fly to this shot" onClick={() => p.onGo(s)}>
                        Go
                      </button>
                      <button className="btn small" title="Play from this shot" onClick={() => p.onPlay(tour, i)}>
                        ▶
                      </button>
                      {!isShared && (
                        <>
                          <button
                            className="btn small"
                            title="Replace with the current view"
                            onClick={() => {
                              const cam = p.currentCamera();
                              if (cam) setShot(i, { camera: cam });
                            }}
                          >
                            Set
                          </button>
                          <button className="btn small" aria-label="Move up" onClick={() => move(i, -1)}>
                            ↑
                          </button>
                          <button className="btn small" aria-label="Move down" onClick={() => move(i, 1)}>
                            ↓
                          </button>
                          <button
                            className="btn small"
                            aria-label="Remove shot"
                            onClick={() => update({ ...tour, shots: tour.shots.filter((_, j) => j !== i) })}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            {!isShared && (
              <button className="btn" onClick={addShot}>
                + Add the current view
              </button>
            )}
            <p className="quiet small">
              Moving the map during a flight stops the tour. Captions show at the bottom of the map while it plays.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
