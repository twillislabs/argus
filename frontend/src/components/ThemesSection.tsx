import { useEffect, useState } from 'react';

import { getThemes, putThemes } from '../lib/api';
import {
  applyTheme,
  BUILTIN_THEMES,
  COLOR_HELP,
  COLOR_KEYS,
  type ColorKey,
  type Corners,
  currentTheme,
  FONTS,
  type FontId,
  MAP_HELP,
  MAP_KEYS,
  type MapKey,
  type Overlay,
  resolveTheme,
  type Stripe,
  type Theme,
  type ThemeDef,
} from '../lib/themes';

// Settings › Themes (admins): custom themes, each starting from a
// built-in one. Edit colours, fonts and effects, preview on this page,
// save for everyone; or paste and copy a theme as JSON (the format in
// docs: using/themes.md). The server checks every value.

const OVERLAYS: Overlay[] = ['none', 'scanlines', 'crt', 'sheen', 'grid'];
const STRIPES: Stripe[] = ['none', 'cassette', 'neon', 'line'];
const CORNERS: Corners[] = ['round', 'square', 'cut'];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// "#rrggbb" for the colour picker, from a hex value (rgba stays as typed).
const pickerValue = (v: string) =>
  /^#[0-9a-f]{6}$/i.test(v)
    ? v
    : /^#[0-9a-f]{3}$/i.test(v)
      ? '#' + [...v.slice(1)].map((c) => c + c).join('')
      : '#000000';

export default function ThemesSection({ onSaved }: { onSaved: () => Promise<void> }) {
  const [items, setItems] = useState<ThemeDef[] | null>(null);
  const [editing, setEditing] = useState<ThemeDef | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // The theme this page had before a preview, to put back.
  const [before] = useState<Theme>(() => currentTheme());

  useEffect(() => {
    getThemes()
      .then((r) => setItems(r.items))
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load the themes.'));
    return () => applyTheme(before);
  }, [before]);

  async function save(next: ThemeDef[], message: string) {
    setBusy(true);
    try {
      const r = await putThemes(next);
      setItems(r.items);
      setStatus(message);
      await onSaved();
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startNew(base: string) {
    const from = BUILTIN_THEMES.find((t) => t.id === base);
    setEditing({ id: '', name: '', base, blurb: '' });
    setStatus('');
    if (from) applyTheme(resolveTheme(from));
  }

  function preview(def: ThemeDef) {
    applyTheme(resolveTheme({ ...def, id: def.id || 'preview' }));
  }

  async function saveEditing() {
    if (!editing || !items) return;
    const id = editing.id || slug(editing.name);
    const def = { ...editing, id };
    const others = items.filter((t) => t.id !== id);
    if (await save([...others, def], 'Saved ' + def.name + '.')) {
      setEditing(null);
      applyTheme(before);
    }
  }

  if (!items) return <p className="quiet pad">{status || 'Loading…'}</p>;
  const resolved = editing ? resolveTheme(editing) : null;
  const setColor = (group: 'colors' | 'map', key: string, value: string) =>
    setEditing((e) => (e ? { ...e, [group]: { ...(e[group] ?? {}), [key]: value } } : e));
  const clearColor = (group: 'colors' | 'map', key: string) =>
    setEditing((e) => {
      if (!e) return e;
      const next = { ...(e[group] ?? {}) } as Record<string, string>;
      delete next[key];
      return { ...e, [group]: next };
    });

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Custom themes</h2>
          <span className="mono">{items.length}</span>
        </div>
        <div className="cbody">
          <p className="quiet small">
            A custom theme starts from a built-in one and changes what you choose: colours, fonts, corners, glow, a
            screen overlay and a header stripe. Everyone can pick it in Settings › Display, and Settings › Defaults can
            make it everyone&apos;s. See the documentation (Using Argus › Themes) for the format.
          </p>
          {items.length > 0 && (
            <ul className="tokenlist">
              {items.map((t) => (
                <li key={t.id}>
                  <span>
                    <b>{t.name}</b>
                    <small className="quiet">
                      {t.id} · from {BUILTIN_THEMES.find((b) => b.id === t.base)?.name ?? t.base}
                    </small>
                  </span>
                  <span className="actions">
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditing(structuredClone(t));
                        preview(t);
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn small" onClick={() => setJson(JSON.stringify(t, null, 2))}>
                      JSON
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => {
                        if (window.confirm('Delete ' + t.name + '? People using it go back to the default.'))
                          void save(
                            items.filter((x) => x.id !== t.id),
                            'Deleted ' + t.name + '.',
                          );
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <label className="field inline">
              <span>New theme from</span>
              <select defaultValue="" onChange={(e) => e.target.value && startNew(e.target.value)}>
                <option value="" disabled>
                  Choose a built-in theme…
                </option>
                {BUILTIN_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn small" onClick={() => setJson('')}>
              Paste JSON…
            </button>
          </div>
          {status && <p className="small">{status}</p>}
        </div>
      </section>

      {json !== null && (
        <section className="card">
          <div className="ph">
            <h2>Theme as JSON</h2>
          </div>
          <div className="cbody">
            <textarea
              className="codeedit mono"
              rows={14}
              value={json}
              spellCheck={false}
              aria-label="Theme JSON"
              onChange={(e) => setJson(e.target.value)}
            />
            <span className="actions">
              <button
                className="btn small primary"
                disabled={busy || !json.trim()}
                onClick={() => {
                  try {
                    const def = JSON.parse(json) as ThemeDef;
                    setEditing(def);
                    preview(def);
                    setJson(null);
                    setStatus('Loaded: check the preview, then Save.');
                  } catch {
                    setStatus('That isn’t valid JSON.');
                  }
                }}
              >
                Load into the editor
              </button>
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(json)}>
                Copy
              </button>
              <button className="btn small" onClick={() => setJson(null)}>
                Close
              </button>
            </span>
          </div>
        </section>
      )}

      {editing && resolved && (
        <section className="card wide">
          <div className="ph">
            <h2>{editing.name || 'New theme'}</h2>
            <span className="mono">previewing on this page</span>
          </div>
          <div className="cbody themeedit">
            <div className="pairform">
              <div className="field">
                <label htmlFor="th-name">Name</label>
                <input
                  id="th-name"
                  value={editing.name}
                  maxLength={40}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="th-id">Id</label>
                <input
                  id="th-id"
                  value={editing.id}
                  maxLength={40}
                  placeholder={slug(editing.name) || 'my-theme'}
                  onChange={(e) => setEditing({ ...editing, id: slug(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="th-base">Starts from</label>
                <select
                  id="th-base"
                  value={editing.base ?? 'dark'}
                  onChange={(e) => {
                    const next = { ...editing, base: e.target.value };
                    setEditing(next);
                    preview(next);
                  }}
                >
                  {BUILTIN_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="th-blurb">Description</label>
              <input
                id="th-blurb"
                value={editing.blurb ?? ''}
                maxLength={120}
                onChange={(e) => setEditing({ ...editing, blurb: e.target.value })}
              />
            </div>

            <h3 className="small">Look</h3>
            <div className="themegrid">
              {(['head', 'body', 'mono'] as const).map((role) => (
                <label key={role} className="field">
                  <span>{role === 'head' ? 'Heading font' : role === 'body' ? 'Text font' : 'Numbers font'}</span>
                  <select
                    value={resolved.fonts[role]}
                    onChange={(e) =>
                      setEditing({ ...editing, fonts: { ...(editing.fonts ?? {}), [role]: e.target.value as FontId } })
                    }
                  >
                    {(Object.keys(FONTS) as FontId[]).map((f) => (
                      <option key={f} value={f}>
                        {FONTS[f].name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="field">
                <span>Corners</span>
                <select
                  value={resolved.corners}
                  onChange={(e) => setEditing({ ...editing, corners: e.target.value as Corners })}
                >
                  {CORNERS.map((c) => (
                    <option key={c} value={c}>
                      {c === 'cut' ? 'cut (angled)' : c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Corner radius · {resolved.radius} px</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={resolved.radius}
                  onChange={(e) => setEditing({ ...editing, radius: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Glow · {Math.round(resolved.glow * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={resolved.glow}
                  onChange={(e) => setEditing({ ...editing, glow: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Screen overlay</span>
                <select
                  value={resolved.overlay}
                  onChange={(e) => setEditing({ ...editing, overlay: e.target.value as Overlay })}
                >
                  {OVERLAYS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Header stripe</span>
                <select
                  value={resolved.stripe}
                  onChange={(e) => setEditing({ ...editing, stripe: e.target.value as Stripe })}
                >
                  {STRIPES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <h3 className="small">Colours</h3>
            <div className="themegrid">
              {COLOR_KEYS.map((k) => (
                <ColorField
                  key={k}
                  label={COLOR_HELP[k]}
                  value={resolved.colors[k]}
                  own={editing.colors?.[k as ColorKey] !== undefined}
                  onChange={(v) => setColor('colors', k, v)}
                  onReset={() => clearColor('colors', k)}
                />
              ))}
            </div>
            <h3 className="small">Dark map</h3>
            <div className="themegrid">
              {MAP_KEYS.map((k) => (
                <ColorField
                  key={k}
                  label={MAP_HELP[k]}
                  value={resolved.map[k]}
                  own={editing.map?.[k as MapKey] !== undefined}
                  onChange={(v) => setColor('map', k, v)}
                  onReset={() => clearColor('map', k)}
                />
              ))}
            </div>
            <span className="actions">
              <button className="btn small" onClick={() => preview(editing)}>
                Preview
              </button>
              <button
                className="btn small primary"
                disabled={busy || !(editing.name.trim() && (editing.id || slug(editing.name)))}
                onClick={() => void saveEditing()}
              >
                Save theme
              </button>
              <button
                className="btn small"
                onClick={() => setJson(JSON.stringify({ ...editing, id: editing.id || slug(editing.name) }, null, 2))}
              >
                Show JSON
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setEditing(null);
                  applyTheme(before);
                }}
              >
                Cancel
              </button>
            </span>
          </div>
        </section>
      )}
    </>
  );
}

function ColorField({
  label,
  value,
  own,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  // Set by this theme (otherwise from its base).
  own: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <div className={'field colorfield' + (own ? ' own' : '')}>
      <span>{label}</span>
      <span className="colorrow">
        <input
          type="color"
          aria-label={label + ' (picker)'}
          value={pickerValue(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <input aria-label={label} value={value} maxLength={40} onChange={(e) => onChange(e.target.value.trim())} />
        {own && (
          <button className="btn small" title="Back to the base theme's colour" onClick={onReset}>
            ↺
          </button>
        )}
      </span>
    </div>
  );
}
