import { allThemes, resolveTheme, type ThemeDef } from '../lib/themes';

// A grid of themes, each with its colours, for Settings › Display (your
// own, or "Server default") and Settings › Defaults (everyone's).

export default function ThemePicker({
  custom,
  value,
  onPick,
  serverDefault,
}: {
  custom: ThemeDef[];
  // The chosen id; null for "server default" (when serverDefault is given).
  value: string | null;
  onPick: (id: string | null) => void;
  // Offer "Server default" first, naming the server's theme.
  serverDefault?: string;
}) {
  const list = allThemes(custom);
  const name = (id: string | undefined) => list.find((t) => t.id === id)?.name ?? 'Argus Dark';
  return (
    <div className="themepick" role="radiogroup" aria-label="Theme">
      {serverDefault !== undefined && (
        <button
          role="radio"
          aria-checked={value === null}
          className={'themecard' + (value === null ? ' on' : '')}
          onClick={() => onPick(null)}
        >
          <Swatches def={list.find((t) => t.id === serverDefault)} />
          <span>
            <b>Server default</b>
            <small>{name(serverDefault)}, set by an admin</small>
          </span>
        </button>
      )}
      {list.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={value === t.id}
          className={'themecard' + (value === t.id ? ' on' : '')}
          onClick={() => onPick(t.id)}
        >
          <Swatches def={t} />
          <span>
            <b>{t.name}</b>
            <small>{t.blurb ?? (t.base ? 'Custom, from ' + name(t.base) : '')}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function Swatches({ def }: { def: ThemeDef | undefined }) {
  const t = resolveTheme(def);
  return (
    <span className="swatches" aria-hidden="true">
      {[t.colors.bg, t.colors.surface, t.map.land, t.colors.accent, t.colors.crit].map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}
