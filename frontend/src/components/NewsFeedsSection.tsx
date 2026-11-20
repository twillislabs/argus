import { useEffect, useRef, useState } from 'react';

import { type FeedsState, getFeeds, type NewsFeed, putFeeds, resetFeeds, testFeed } from '../lib/api';
import { ago } from '../lib/format';
import ChoiceInput from './ChoiceInput';
import NameHeader from './NameHeader';

// Settings > News feeds (admins): the RSS / Atom feeds the worker reads
// every ten minutes. Their headlines back events, title confirmed ones,
// fill the Brief's top stories and make headline-led incidents. Each
// change is saved at once; Reset goes back to Argus's built-in list.

type Test = Awaited<ReturnType<typeof testFeed>>;
const EMPTY: NewsFeed = { outlet: '', url: '', section: '', based: 'us', enabled: true };

export default function NewsFeedsSection() {
  const [state, setState] = useState<FeedsState | null>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  // The feed being added (index -1) or edited (its index).
  const [editing, setEditing] = useState<{ index: number; feed: NewsFeed } | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const [testing, setTesting] = useState(false);
  // A section being added.
  const [newSection, setNewSection] = useState<string | null>(null);
  const form = useRef<HTMLDivElement>(null);
  // Editing a feed far down the list: bring the form into view.
  const editingIndex = editing?.index;
  useEffect(() => {
    if (editingIndex !== undefined) form.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [editingIndex]);
  useEffect(() => {
    getFeeds()
      .then(setState)
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load the feeds.'));
  }, []);

  if (!state) return <p className="quiet pad">{status || 'Loading…'}</p>;
  const items = state.items;
  const sections = state.sections;
  const outlets = new Set(items.map((f) => f.outlet)).size;
  const q = query.trim().toLowerCase();
  const shown = items
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !q || (f.outlet + ' ' + f.url + ' ' + f.section).toLowerCase().includes(q));

  async function save(next: NewsFeed[], message = 'Saved.', names: string[] = sections) {
    // Every section a feed is in is listed, new ones last.
    const all = [...names, ...next.map((f) => f.section).filter((x) => !names.includes(x))];
    try {
      setState(await putFeeds(next, [...new Set(all)]));
      setStatus(message);
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
      return false;
    }
  }
  async function runTest(url: string) {
    setTesting(true);
    setTest(null);
    try {
      setTest(await testFeed(url));
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : 'Could not test it.' });
    } finally {
      setTesting(false);
    }
  }
  async function submit() {
    if (!editing) return;
    const feed = { ...editing.feed, outlet: editing.feed.outlet.trim(), url: editing.feed.url.trim() };
    if (!feed.outlet || !feed.url) return setStatus('A feed needs an outlet name and an address.');
    feed.section = feed.section.trim() || 'General';
    const next = [...items];
    if (editing.index < 0) next.push(feed);
    else next[editing.index] = feed;
    if (await save(next, editing.index < 0 ? 'Added ' + feed.outlet + '.' : 'Saved ' + feed.outlet + '.')) {
      setEditing(null);
      setTest(null);
    }
  }

  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Feeds</h2>
          <span className="mono">
            {items.length} feeds · {outlets} outlets · {state.customised ? 'edited' : 'built-in list'}
          </span>
        </div>
        <div className="srows">
          <div className="srow">
            <span className="srow-label">
              <b>Find or add a feed</b>
              <small>Use the feed&apos;s RSS or Atom address, not the web page. Test it before saving.</small>
            </span>
            <span className="actions">
              <input
                className="sfilter"
                type="search"
                placeholder="Filter by outlet, section or address"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="btn small primary"
                onClick={() => {
                  setEditing({ index: -1, feed: { ...EMPTY, section: sections[0] ?? 'General' } });
                  setTest(null);
                }}
              >
                Add feed
              </button>
              <button className="btn small" onClick={() => setNewSection('')}>
                Add section
              </button>
              {state.customised && (
                <button
                  className="btn small"
                  onClick={() => {
                    if (!window.confirm('Go back to the built-in feeds? Your additions and changes are removed.'))
                      return;
                    void resetFeeds().then((s) => {
                      setState(s);
                      setStatus('Back to the built-in feeds.');
                    });
                  }}
                >
                  Reset to built-in
                </button>
              )}
            </span>
          </div>
          {newSection !== null && (
            <form
              className="srow srename"
              onSubmit={(e) => {
                e.preventDefault();
                const n = newSection.trim();
                if (!n) return;
                if (sections.includes(n)) return setStatus(n + ' is already a section.');
                void save(items, 'Added the ' + n + ' section.', [...sections, n]).then(
                  (ok) => ok && setNewSection(null),
                );
              }}
            >
              <input
                autoFocus
                aria-label="New section name"
                placeholder="New section name"
                value={newSection}
                maxLength={40}
                onChange={(e) => setNewSection(e.target.value)}
              />
              <button className="btn small primary">Add</button>
              <button type="button" className="btn small" onClick={() => setNewSection(null)}>
                Cancel
              </button>
            </form>
          )}
          {editing && (
            <div className="srow col" ref={form}>
              <span className="srow-label">
                <b>{editing.index < 0 ? 'New feed' : 'Edit ' + items[editing.index].outlet}</b>
              </span>
              <div className="aigrid">
                <label className="field">
                  <span>Outlet</span>
                  <input
                    value={editing.feed.outlet}
                    placeholder="Reuters"
                    maxLength={80}
                    onChange={(e) => setEditing({ ...editing, feed: { ...editing.feed, outlet: e.target.value } })}
                  />
                </label>
                <label className="field">
                  <span>Feed address</span>
                  <input
                    value={editing.feed.url}
                    placeholder="https://…/rss.xml"
                    maxLength={500}
                    onChange={(e) => setEditing({ ...editing, feed: { ...editing.feed, url: e.target.value } })}
                  />
                </label>
                <div className="field">
                  <span>Section</span>
                  <ChoiceInput
                    label="Section"
                    value={editing.feed.section}
                    options={sections}
                    newLabel="New section…"
                    onChange={(v) => setEditing({ ...editing, feed: { ...editing.feed, section: v } })}
                  />
                </div>
                <label className="field">
                  <span>Outlet based in</span>
                  <select
                    value={editing.feed.based}
                    onChange={(e) =>
                      setEditing({ ...editing, feed: { ...editing.feed, based: e.target.value as NewsFeed['based'] } })
                    }
                  >
                    <option value="us">The US</option>
                    <option value="world">Elsewhere</option>
                  </select>
                </label>
              </div>
              <p className="quiet small">
                Where the outlet is based helps tell US top stories from world ones when a story names no country.
              </p>
              <span className="actions">
                <button
                  className="btn small"
                  disabled={testing || !editing.feed.url.trim()}
                  onClick={() => void runTest(editing.feed.url.trim())}
                >
                  {testing ? 'Testing…' : 'Test'}
                </button>
                <button className="btn small primary" onClick={() => void submit()}>
                  {editing.index < 0 ? 'Add' : 'Save'}
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    setEditing(null);
                    setTest(null);
                  }}
                >
                  Cancel
                </button>
              </span>
              {test && <TestResult test={test} />}
            </div>
          )}
        </div>
      </section>

      {sections
        .filter((section) => !q || shown.some(({ f }) => f.section === section))
        .map((section, si) => (
          <section key={section} className="card">
            <NameHeader
              name={section}
              noun="section"
              count={shown.filter(({ f }) => f.section === section).length}
              first={si === 0}
              last={si === sections.length - 1}
              onMove={(by) => {
                const next = [...sections];
                const j = si + by;
                [next[si], next[j]] = [next[j], next[si]];
                void save(items, 'Moved ' + section + '.', next);
              }}
              onRename={(to) =>
                save(
                  items.map((x) => (x.section === section ? { ...x, section: to } : x)),
                  'Renamed ' + section + ' to ' + to + '.',
                  sections.includes(to)
                    ? sections.filter((x) => x !== section)
                    : sections.map((x) => (x === section ? to : x)),
                )
              }
              onDelete={() => {
                const n = items.filter((x) => x.section === section).length;
                const msg = n
                  ? 'Delete the ' +
                    section +
                    ' section and its ' +
                    n +
                    ' feed' +
                    (n === 1 ? '' : 's') +
                    '? To keep them, rename the section to another one instead.'
                  : 'Delete the ' + section + ' section?';
                if (!window.confirm(msg)) return;
                void save(
                  items.filter((x) => x.section !== section),
                  'Deleted the ' + section + ' section.',
                  sections.filter((x) => x !== section),
                );
              }}
            />
            {!items.some((x) => x.section === section) && (
              <p className="quiet small pad">No feeds yet. Add one and choose this section.</p>
            )}
            <ul className="nlist">
              {shown
                .filter(({ f }) => f.section === section)
                .map(({ f, i }) => (
                  <li key={f.url} className={f.enabled ? undefined : 'off'}>
                    <label className="lrow flat">
                      <input
                        type="checkbox"
                        aria-label={(f.enabled ? 'Turn off ' : 'Turn on ') + f.outlet}
                        checked={f.enabled}
                        onChange={(e) =>
                          void save(
                            items.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)),
                            (e.target.checked ? 'Turned on ' : 'Turned off ') + f.outlet + '.',
                          )
                        }
                      />
                      <span className="tog" />
                    </label>
                    <span className="cname">
                      <b>
                        {f.outlet}
                        {state.failing.includes(f.outlet) && (
                          <span className="badge warn" title="The last fetch of one of this outlet's feeds failed">
                            failing
                          </span>
                        )}
                        {f.based === 'world' && <span className="badge">outside US</span>}
                      </b>
                      <small className="mono" title={f.url}>
                        {f.url}
                      </small>
                    </span>
                    <span className="actions">
                      <button
                        className="btn small"
                        onClick={() => {
                          setEditing({ index: i, feed: { ...f } });
                          setTest(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn small"
                        aria-label={'Remove ' + f.outlet + ' feed'}
                        onClick={() => {
                          if (window.confirm('Remove this ' + f.outlet + ' feed?'))
                            void save(
                              items.filter((_, j) => j !== i),
                              'Removed a ' + f.outlet + ' feed.',
                            );
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      {!shown.length && <p className="quiet pad">No feeds match.</p>}
      {status && <p className="quiet small pad">{status}</p>}
    </>
  );
}

function TestResult({ test }: { test: Test }) {
  if (!test.ok) return <p className="err small">{test.error}</p>;
  return (
    <div className="feedtest">
      <p className="ok small">
        Read {test.count} headlines{test.newest ? ', the newest ' + ago(test.newest) : ''}:
      </p>
      <ul>
        {(test.titles ?? []).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
