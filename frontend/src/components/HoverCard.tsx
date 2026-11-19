import { useSyncExternalStore } from 'react';

import { hoverStore } from '../lib/hover';

// A small card for the map item under the pointer, as in Foundry Map's
// hover labels: what it is and its key facts, without clicking.

export interface HoverInfo {
  title: string;
  lines: string[];
  color?: string;
}

export default function HoverCard({ info, x, y }: { info: HoverInfo; x: number; y: number }) {
  return (
    <div className="hovercard" role="status" style={{ left: x + 14, top: y + 14 }}>
      <b>
        {info.color && <i style={{ background: info.color }} />}
        {info.title}
      </b>
      {info.lines.filter(Boolean).map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

// Shows the card for whatever the globe says is under the pointer.
export function HoverLayer({ describe }: { describe: (id: string) => HoverInfo | null }) {
  const hover = useSyncExternalStore(hoverStore.subscribe, hoverStore.get);
  const info = hover ? describe(hover.id) : null;
  return hover && info ? <HoverCard info={info} x={hover.x} y={hover.y} /> : null;
}
