import { useState } from 'react';

import { type AskAnswer, withCitations } from '../lib/ai';

// Ask Argus: questions answered by the AI with read-only tools over
// what Argus holds. Answers cite events (click to open them) and may
// suggest a map view (a button: the AI never moves the map itself).

export interface AskItem {
  q: string;
  a?: AskAnswer;
  error?: string;
}

const EXAMPLES = [
  'What happened near home today?',
  'Any military aircraft over the Black Sea right now?',
  'Summarise the fighting in Sudan this week.',
  'Which countries have the highest tension, and why?',
];

export default function AskPanel({
  items,
  busy,
  onAsk,
  onEvent,
  onView,
  onClose,
}: {
  items: AskItem[];
  busy: boolean;
  onAsk: (q: string) => void;
  onEvent: (id: string) => void;
  onView: (v: NonNullable<AskAnswer['view']>) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const submit = (text: string) => {
    const t = text.trim();
    if (t.length < 2 || busy) return;
    onAsk(t);
    setQ('');
  };
  return (
    <div className="inspector-body ask">
      <div className="isec tight">
        <button className="backlink" onClick={onClose}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <h1 className="etitle">
          <span className="aibadge">AI</span>Ask Argus
        </h1>
        <div className="sub">
          Questions about the events, tension, headlines, aircraft and ships Argus holds. Answers come from that data
          and cite their events.
        </div>
        <form
          className="askform"
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
          }}
        >
          <textarea
            value={q}
            maxLength={600}
            rows={3}
            placeholder="Ask about the map…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(q);
              }
            }}
          />
          <button className="btn primary" disabled={busy || q.trim().length < 2}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>
        {!items.length && (
          <ul className="askexamples">
            {EXAMPLES.map((x) => (
              <li key={x}>
                <button className="backlink" onClick={() => submit(x)}>
                  {x}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {[...items].reverse().map((it, i) => (
        <section key={items.length - i} className="isec askitem">
          <p className="askq">{it.q}</p>
          {it.error ? (
            <p className="err small">{it.error}</p>
          ) : !it.a ? (
            <p className="quiet small">Looking through Argus’s data…</p>
          ) : (
            <>
              <div className="aska">
                {it.a.answer.split(/\n{2,}/).map((para, j) => (
                  <p key={j}>
                    {withCitations(para).map((part, k) =>
                      'event' in part ? (
                        <button key={k} className="cite" title="Open this event" onClick={() => onEvent(part.event)}>
                          {part.event.slice(0, 6)}
                        </button>
                      ) : (
                        <span key={k}>{part.text}</span>
                      ),
                    )}
                  </p>
                ))}
              </div>
              {it.a.view && (
                <button className="btn small" onClick={() => it.a?.view && onView(it.a.view)}>
                  Show on map{it.a.view.label ? ': ' + it.a.view.label : ''}
                </button>
              )}
              <p className="quiet small">
                {it.a.model}
                {it.a.tools.length ? ' · looked at ' + [...new Set(it.a.tools)].join(', ').replace(/_/g, ' ') : ''}
              </p>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
