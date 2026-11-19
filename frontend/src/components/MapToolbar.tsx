import { useEffect, useRef, useState } from 'react';

import type { Tool } from '../map/drawTools';

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  onCapture: () => void;
  onClear: () => void;
  drawingCount: number;
  toursOpen: boolean;
  onTours: () => void;
}

const SELECT: { id: Tool; label: string }[] = [
  { id: 'select-box', label: 'Box' },
  { id: 'select-polygon', label: 'Polygon' },
  { id: 'select-circle', label: 'Circle' },
];
const DRAW: { id: Tool; label: string }[] = [
  { id: 'point', label: 'Point' },
  { id: 'line', label: 'Line' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
];

function Menu({
  label,
  items,
  tool,
  onTool,
}: {
  label: string;
  items: { id: Tool; label: string }[];
  tool: Tool;
  onTool: (t: Tool) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = items.some((i) => i.id === tool);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="tbmenu" ref={box}>
      <button aria-pressed={active} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        {active ? ' · ' + items.find((i) => i.id === tool)?.label : ''} ▾
      </button>
      {open && (
        <div className="tbdrop" role="menu">
          {items.map((i) => (
            <button
              key={i.id}
              role="menuitem"
              aria-pressed={tool === i.id}
              onClick={() => {
                onTool(tool === i.id ? 'none' : i.id);
                setOpen(false);
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Delete: click drawings one at a time, or all of them at once.
function DeleteMenu({
  active,
  count,
  onPick,
  onAll,
}: {
  active: boolean;
  count: number;
  onPick: () => void;
  onAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="tbmenu" ref={box}>
      <button
        aria-pressed={active}
        aria-expanded={open}
        disabled={!count}
        title={count ? 'Delete drawings and notes' : 'Nothing drawn yet'}
        onClick={() => setOpen(!open)}
      >
        Delete{active ? ' · click one' : ''} ▾
      </button>
      {open && (
        <div className="tbdrop" role="menu">
          <button
            role="menuitem"
            aria-pressed={active}
            onClick={() => {
              onPick();
              setOpen(false);
            }}
          >
            Click to delete
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAll();
            }}
          >
            Delete all ({count})
          </button>
        </div>
      )}
    </div>
  );
}

// The map toolbar (as in Foundry Map): select in an area, draw shapes,
// measure, add notes, capture a screenshot, delete drawings.
export default function MapToolbar({ tool, onTool, onCapture, onClear, drawingCount, toursOpen, onTours }: Props) {
  const toggle = (t: Tool) => onTool(tool === t ? 'none' : t);
  return (
    <div className="maptoolbar seg" role="toolbar" aria-label="Map tools">
      <Menu label="Select" items={SELECT} tool={tool} onTool={onTool} />
      <Menu label="Draw" items={DRAW} tool={tool} onTool={onTool} />
      <button
        aria-pressed={tool === 'measure'}
        title="Measure distance (click points, double-click to finish)"
        onClick={() => toggle('measure')}
      >
        Measure
      </button>
      <button aria-pressed={tool === 'text'} title="Add a note to the map" onClick={() => toggle('text')}>
        Note
      </button>
      <button
        aria-pressed={tool === 'imagery-box'}
        title="Recent satellite imagery: draw a box (Sentinel-2 and Sentinel-1)"
        onClick={() => toggle('imagery-box')}
      >
        Imagery
      </button>
      <button aria-pressed={toursOpen} title="Director mode: saved camera tours with captions" onClick={onTours}>
        Tours
      </button>
      <button title="Save a PNG of the map" onClick={onCapture}>
        Capture
      </button>
      <DeleteMenu
        active={tool === 'delete'}
        count={drawingCount}
        onPick={() => toggle('delete')}
        onAll={() => {
          if (tool === 'delete') onTool('none');
          onClear();
        }}
      />
    </div>
  );
}
