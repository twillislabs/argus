import { useEffect, useRef } from 'react';

import { latLon } from '../lib/format';
import { toMgrs } from '../lib/mgrs';
import { copyText, decimal } from './CopyCoords';

interface Props {
  lat: number;
  lon: number;
  x: number;
  y: number;
  onClose: () => void;
  onCentre: () => void;
  onWeather?: () => void;
  onPhotos?: () => void;
  onCopied: (what: string) => void;
}

// Right-click on the map: copy the spot's coordinates in a few formats,
// see its weather, or centre the map on it.
export default function MapContextMenu({ lat, lon, x, y, onClose, onCentre, onWeather, onPhotos, onCopied }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const mgrs = toMgrs(lat, lon);
  const items: { label: string; value: string }[] = [
    { label: 'Copy coordinates', value: decimal(lat, lon) },
    { label: 'Copy as degrees', value: latLon(lat, lon) },
    ...(mgrs ? [{ label: 'Copy MGRS', value: mgrs }] : []),
  ];
  return (
    <div className="ctxmenu" ref={box} role="menu" style={{ left: x, top: y }}>
      <div className="ctxhead mono">{decimal(lat, lon)}</div>
      {items.map((i) => (
        <button
          key={i.label}
          role="menuitem"
          onClick={() =>
            void copyText(i.value).then((ok) => {
              onCopied(ok ? 'Copied ' + i.value : "Couldn't copy to the clipboard");
              onClose();
            })
          }
        >
          {i.label}
          <small className="mono">{i.value}</small>
        </button>
      ))}
      <button
        role="menuitem"
        onClick={() => {
          onCentre();
          onClose();
        }}
      >
        Centre the map here
      </button>
      {onWeather && (
        <button
          role="menuitem"
          onClick={() => {
            onWeather();
            onClose();
          }}
        >
          Weather here
          <small>Now, 24 hours and 7 days</small>
        </button>
      )}
      {onPhotos && (
        <button
          role="menuitem"
          onClick={() => {
            onPhotos();
            onClose();
          }}
        >
          Street view here
          <small>Google Street View · Mapillary photos</small>
        </button>
      )}
    </div>
  );
}
