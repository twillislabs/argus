import { useState } from 'react';

// Pick one of the existing names (feed sections, channel groups) from a
// dropdown, or choose "New…" and type one. A <datalist> only suggested
// names matching what was already in the box, mixed with the browser's
// autofill history, so it never showed the list.
const NEW = '\u0000new';

export default function ChoiceInput({
  value,
  options,
  onChange,
  newLabel,
  maxLength = 40,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  newLabel: string;
  maxLength?: number;
  label: string;
}) {
  const known = options.includes(value);
  const [typing, setTyping] = useState(false);
  if (typing) {
    return (
      <span className="choice">
        <input
          aria-label={label}
          autoFocus={typing}
          autoComplete="off"
          value={value}
          maxLength={maxLength}
          placeholder={newLabel}
          onChange={(e) => onChange(e.target.value)}
        />
        {options.length > 0 && (
          <button
            type="button"
            className="btn small"
            title="Pick an existing one"
            onClick={() => {
              setTyping(false);
              onChange(options.includes(value) ? value : options[0]);
            }}
          >
            List
          </button>
        )}
      </span>
    );
  }
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setTyping(true);
          onChange('');
        } else onChange(e.target.value);
      }}
    >
      {!known && <option value={value}>{value || 'Choose…'}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={NEW}>{newLabel}</option>
    </select>
  );
}
