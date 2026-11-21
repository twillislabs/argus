import { useEffect, useState } from 'react';

import { getStreetPhotos, type StreetPhoto } from '../lib/api';
import { latLon } from '../lib/format';

// "Street photos here" (the map's right-click menu): the nearest
// street-level photos from Panoramax, the open, federated catalogue (no
// key), each with its author, date, licence and a link to it there.
// Images come through Argus's server.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function taken(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function StreetPhotos({
  lat,
  lon,
  onBack,
  onShow,
}: {
  lat: number;
  lon: number;
  onBack: () => void;
  // Mark the open photo's spot on the map (null to clear).
  onShow?: (photo: StreetPhoto | null) => void;
}) {
  const [photos, setPhotos] = useState<StreetPhoto[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<StreetPhoto | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPhotos(null);
    setOpen(null);
    setError(false);
    getStreetPhotos(lat, lon)
      .then((r) => {
        if (cancelled) return;
        if (r.status !== 'ok') setError(true);
        setPhotos(r.photos);
        setOpen(r.photos[0] ?? null);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);
  useEffect(() => {
    onShow?.(open);
    // onShow comes from the page and doesn't change meaningfully.
  }, [open]);
  useEffect(() => () => onShow?.(null), []);

  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">Street photos here</h1>
        <div className="sub mono">{latLon(lat, lon)} · within 250 m</div>
        {!photos && !error && <p className="quiet small">Looking…</p>}
        {error && <p className="err small">Panoramax didn&apos;t answer. Try again in a minute.</p>}
        {photos && photos.length === 0 && !error && (
          <p className="quiet small">
            No photos within 250 m. Panoramax is built by volunteers, so coverage is best in France and parts of Europe.
          </p>
        )}
        {open && (
          <figure className="streetshot">
            <a href={open.link} target="_blank" rel="noreferrer" title="Open it on Panoramax">
              <img src={open.image} alt={'Street photo ' + open.distance_m + ' m away'} />
            </a>
            <figcaption className="small">
              {open.distance_m} m away
              {open.heading !== null ? ' · looking ' + compass(open.heading) + ' (' + open.heading + '°)' : ''}
              {taken(open.taken) ? ' · ' + taken(open.taken) : ''}
              <br />
              <span className="quiet">
                © {open.author ?? 'contributor'}
                {open.licence ? ', ' : ''}
                {open.licence_url ? (
                  <a href={open.licence_url} target="_blank" rel="noreferrer">
                    {open.licence}
                  </a>
                ) : (
                  open.licence
                )}{' '}
                ·{' '}
                <a href={open.link} target="_blank" rel="noreferrer">
                  Panoramax ↗
                </a>
              </span>
            </figcaption>
          </figure>
        )}
        {photos && photos.length > 1 && (
          <div className="streetthumbs">
            {photos.map((p) => (
              <button
                key={p.id}
                className={p.id === open?.id ? 'on' : ''}
                onClick={() => setOpen(p)}
                title={p.distance_m + ' m' + (p.heading !== null ? ', looking ' + compass(p.heading) : '')}
              >
                <img src={p.thumb} alt="" loading="lazy" />
                <small className="mono">{p.distance_m} m</small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
