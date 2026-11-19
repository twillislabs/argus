import { useState } from 'react';

import { latLon } from '../lib/format';
import { toMgrs } from '../lib/mgrs';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard (insecure context, or permission refused): fall back.
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

export const decimal = (lat: number, lon: number) => lat.toFixed(5) + ', ' + lon.toFixed(5);

// A position with a button that copies it ("36.16220, -86.77430").
export default function CopyCoords({ lat, lon }: { lat: number; lon: number }) {
  const [done, setDone] = useState(false);
  return (
    <span className="coords">
      {latLon(lat, lon)}
      <button
        className="copybtn"
        title={'Copy ' + decimal(lat, lon) + (toMgrs(lat, lon) ? ' (MGRS ' + toMgrs(lat, lon) + ')' : '')}
        aria-label="Copy coordinates"
        onClick={() =>
          void copyText(decimal(lat, lon)).then((ok) => {
            setDone(ok);
            window.setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? '✓' : '⧉'}
      </button>
    </span>
  );
}
