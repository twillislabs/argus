import { useState } from 'react';

// A feed section's or channel group's card header: its name and count,
// and buttons to move it, rename it (or merge it into another by giving
// that name) and delete it.
export default function NameHeader({
  name,
  count,
  noun,
  first,
  last,
  onMove,
  onRename,
  onDelete,
}: {
  name: string;
  count: number;
  noun: string;
  first: boolean;
  last: boolean;
  onMove: (by: number) => void;
  onRename: (to: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [to, setTo] = useState<string | null>(null);
  if (to !== null)
    return (
      <div className="ph">
        <form
          className="srename"
          onSubmit={(e) => {
            e.preventDefault();
            const t = to.trim();
            if (!t || t === name) return setTo(null);
            void onRename(t).then((ok) => ok && setTo(null));
          }}
        >
          <input
            autoFocus
            aria-label={'New name for ' + name}
            value={to}
            maxLength={40}
            onChange={(e) => setTo(e.target.value)}
          />
          <button className="btn small primary">Rename</button>
          <button type="button" className="btn small" onClick={() => setTo(null)}>
            Cancel
          </button>
        </form>
      </div>
    );
  return (
    <div className="ph">
      <h2>{name}</h2>
      <span className="actions">
        <span className="mono">{count}</span>
        <button className="btn small" aria-label={'Move ' + name + ' up'} disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button className="btn small" aria-label={'Move ' + name + ' down'} disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
        <button
          className="btn small"
          title={'Rename this ' + noun + ' (or give another ' + noun + "'s name to merge them)"}
          onClick={() => setTo(name)}
        >
          Rename
        </button>
        <button className="btn small" aria-label={'Delete ' + name} onClick={onDelete}>
          Delete
        </button>
      </span>
    </div>
  );
}
