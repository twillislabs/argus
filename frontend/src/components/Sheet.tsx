import { type ReactNode, useRef, useState } from 'react';

// Phones: a panel (layers, situation, details) as a sheet over the map.
// It slides up when it opens; its handle drags it: down to close, up to
// fill the screen, down again to come back to half; a tap on the handle
// switches between half and full.

const CLOSE_PX = 90;
const SWITCH_PX = 50;

export default function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(false);
  // The drag so far, read when the finger lifts (state may lag a frame).
  const offset = useRef(0);

  const begin = (y: number) => {
    start.current = y;
    offset.current = 0;
    moved.current = false;
  };
  const move = (y: number) => {
    if (start.current === null) return;
    const d = y - start.current;
    if (Math.abs(d) > 6) moved.current = true;
    // Follow the finger down; resist a little going up.
    offset.current = d;
    setDy(d > 0 ? d : d / 3);
  };
  const end = () => {
    if (start.current === null) return;
    const d = offset.current;
    offset.current = 0;
    start.current = null;
    setDy(0);
    if (d > CLOSE_PX && !full) onClose();
    else if (d > SWITCH_PX && full) setFull(false);
    else if (d < -SWITCH_PX / 3 && !full) setFull(true);
  };

  return (
    <div
      className={'sheet' + (full ? ' full' : '') + (dy ? ' dragging' : '')}
      style={dy > 0 ? { transform: 'translateY(' + dy + 'px)' } : undefined}
    >
      <button
        className="sheetgrab"
        aria-label={full ? 'Make the panel smaller (drag down to close)' : 'Make the panel bigger (drag down to close)'}
        onClick={() => {
          if (!moved.current) setFull((f) => !f);
        }}
        onTouchStart={(e) => begin(e.touches[0].clientY)}
        onTouchMove={(e) => move(e.touches[0].clientY)}
        onTouchEnd={end}
        onTouchCancel={end}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            begin(e.clientY);
          }
        }}
        onPointerMove={(e) => e.pointerType === 'mouse' && move(e.clientY)}
        onPointerUp={(e) => e.pointerType === 'mouse' && end()}
      >
        <i />
      </button>
      {children}
    </div>
  );
}
