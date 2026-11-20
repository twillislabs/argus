import { BRIEF_SECTIONS, type BriefPrefs, type BriefSection } from '../lib/api';

// The Brief's sections in order, each with a switch and up / down
// arrows. Used by the Brief's Customize panel (your own order) and
// Settings > Defaults (everyone's starting order).
export default function BriefSectionsEditor({
  layout,
  onChange,
}: {
  layout: { order: BriefSection[]; hidden: BriefSection[] };
  onChange: (next: BriefPrefs) => void;
}) {
  function move(id: BriefSection, by: number) {
    const order = [...layout.order];
    const i = order.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ order, hidden: layout.hidden });
  }
  function toggle(id: BriefSection, on: boolean) {
    const hidden = on ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id];
    onChange({ order: layout.order, hidden });
  }
  return (
    <ul className="cbody briefsections">
      {layout.order.map((id, i, all) => {
        const label = BRIEF_SECTIONS.find((x) => x.id === id)?.label ?? id;
        return (
          <li key={id}>
            <label className="lrow flat">
              <input
                type="checkbox"
                aria-label={'Show ' + label}
                checked={!layout.hidden.includes(id)}
                onChange={(e) => toggle(id, e.target.checked)}
              />
              <span className="tog" />
              <span>{label}</span>
            </label>
            <button
              className="btn small"
              disabled={i === 0}
              title="Move up"
              aria-label={'Move ' + label + ' up'}
              onClick={() => move(id, -1)}
            >
              ↑
            </button>
            <button
              className="btn small"
              disabled={i === all.length - 1}
              title="Move down"
              aria-label={'Move ' + label + ' down'}
              onClick={() => move(id, 1)}
            >
              ↓
            </button>
          </li>
        );
      })}
    </ul>
  );
}
