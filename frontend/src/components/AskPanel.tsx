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
                {blocks(it.a.answer).map((b, j) =>
                  b.list ? (
                    <ul key={j}>
                      {b.lines.map((line, k) => (
                        <li key={k}>
                          <Rich text={line} onEvent={onEvent} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p key={j}>
                      <Rich text={b.lines.join(' ')} onEvent={onEvent} />
                    </p>
                  ),
                )}
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

// The model writes light Markdown: paragraphs, "- " bullet lists and
// **bold**. Rendered as such (never as HTML), with [E:<id>] citations
// as buttons that open the event.
function blocks(text: string): { list: boolean; lines: string[] }[] {
  const out: { list: boolean; lines: string[] }[] = [];
  for (const para of text.split(/\n{2,}/)) {
    let current: { list: boolean; lines: string[] } | null = null;
    for (const raw of para.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[-*•]\s+/.test(line);
      const clean = line.replace(/^[-*•]\s+/, '').replace(/^#+\s+/, '');
      if (!current || current.list !== bullet) {
        current = { list: bullet, lines: [] };
        out.push(current);
      }
      current.lines.push(clean);
    }
  }
  return out;
}

function Rich({ text, onEvent }: { text: string; onEvent: (id: string) => void }) {
  return (
    <>
      {withCitations(text).map((part, k) =>
        'event' in part ? (
          <button key={k} className="cite" title="Open this event" onClick={() => onEvent(part.event)}>
            {part.event.slice(0, 6)}
          </button>
        ) : (
          part.text
            .split(/(\*\*[^*]+\*\*)/)
            .map((bit, m) =>
              bit.startsWith('**') && bit.endsWith('**') && bit.length > 4 ? (
                <b key={k + '-' + m}>{bit.slice(2, -2)}</b>
              ) : (
                <span key={k + '-' + m}>{bit}</span>
              ),
            )
        ),
      )}
    </>
  );
}
