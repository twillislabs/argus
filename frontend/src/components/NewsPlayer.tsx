import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

import { CHANNELS, DEFAULT_TABS } from '../config/newsChannels';
import LiveFrame from './LiveFrame';

interface Props {
  // Which player this is (0 is the first); each remembers its own place.
  index: number;
  channel: string;
  tabs: string[];
  onChannel: (id: string) => void;
  onTabs: (ids: string[]) => void;
  onClose: () => void;
  // Another player on the map, and this channel in its own window.
  onAdd?: () => void;
}

const POS_KEY = 'argus-news-pos';

interface Box {
  x: number;
  y: number;
  w: number;
}

const posKey = (index: number) => (index ? POS_KEY + '-' + index : POS_KEY);

function loadBox(index: number): Box | null {
  try {
    const raw = localStorage.getItem(posKey(index));
    return raw ? (JSON.parse(raw) as Box) : null;
  } catch {
    return null;
  }
}

// A floating live news player over the map: channel tabs, drag by the
// header, resize from the corner. Muted until you unmute in the player.
export default function NewsPlayer({ index, channel, tabs, onChannel, onTabs, onClose, onAdd }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(() => loadBox(index));
  const [picking, setPicking] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const current = CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0];
  const known = (ids: string[]) =>
    ids.map((id) => CHANNELS.find((c) => c.id === id)).filter((c): c is (typeof CHANNELS)[number] => Boolean(c));
  // Saved tabs can name channels since removed: fall back to the defaults.
  const shown = known(tabs).length ? known(tabs) : known(DEFAULT_TABS);

  function save(next: Box) {
    setBox(next);
    try {
      localStorage.setItem(posKey(index), JSON.stringify(next));
    } catch {
      // Storage blocked: position resets next time.
    }
  }

  function onDown(e: ReactPointerEvent) {
    const el = panel.current;
    if (!el || (e.target as HTMLElement).closest('button')) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: ReactPointerEvent) {
    const el = panel.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!drag.current || !el || !parent) return;
    const pr = parent.getBoundingClientRect();
    const x = Math.max(0, Math.min(pr.width - 120, e.clientX - pr.left - drag.current.dx));
    const y = Math.max(0, Math.min(pr.height - 40, e.clientY - pr.top - drag.current.dy));
    setBox({ x, y, w: el.offsetWidth });
  }
  function onUp() {
    if (drag.current && box) save({ ...box, w: panel.current?.offsetWidth ?? box.w });
    drag.current = null;
  }

  // Remember the size after a corner resize.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!drag.current && box && Math.abs(el.offsetWidth - box.w) > 4) save({ ...box, w: el.offsetWidth });
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  const style = box
    ? { left: box.x, top: box.y, width: box.w, right: 'auto', bottom: 'auto' }
    : index
      ? { right: 12 + index * 28, bottom: 40 + index * 28 }
      : undefined;
  return (
    <div ref={panel} className="newsplayer" style={style} role="dialog" aria-label="Live news">
      <div className="np-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="np-live">
          <i /> LIVE
        </span>
        <b>{current.name}</b>
        {onAdd && (
          <button className="np-btn" title="Add another player" aria-label="Add another news player" onClick={onAdd}>
            +
          </button>
        )}
        <button
          className="np-btn"
          title="Open in its own window"
          aria-label="Pop out"
          onClick={() =>
            window.open('/news?c=' + encodeURIComponent(current.id), 'argus-news-' + current.id, 'popup,width=960,height=600')
          }
        >
          ⧉
        </button>
        <button className="np-btn" title="Choose channels" onClick={() => setPicking(!picking)}>
          ⋯
        </button>
        <button className="np-btn" title="Close" aria-label="Close news player" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="np-tabs" role="tablist">
        {shown.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === channel} onClick={() => onChannel(c.id)}>
            {c.short}
          </button>
        ))}
      </div>
      {picking ? (
        <div className="np-pick">
          {(['US', 'International', 'Business', 'Weather'] as const).map((g) => (
            <div key={g}>
              <div className="np-group">{g}</div>
              {CHANNELS.filter((c) => c.group === g).map((c) => {
                const on = shown.some((s) => s.id === c.id);
                return (
                  <label key={c.id} className="np-opt">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        onTabs(on ? shown.filter((s) => s.id !== c.id).map((s) => s.id) : [...shown.map((s) => s.id), c.id])
                      }
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <LiveFrame channel={current} />
      )}
      <div className="np-foot">Streams are the channels&apos; own, played through {current.platform === 'rumble' ? 'Rumble' : 'YouTube'}.</div>
    </div>
  );
}
