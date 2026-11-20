import { useEffect, useState } from 'react';

import {
  type AiFeature,
  type AiKind,
  type AiSettings,
  getAiSettings,
  PROVIDER_LABEL,
  putAiSettings,
  testAi,
} from '../lib/ai';

// Settings > AI (admins): providers and their keys, which feature uses
// which model, a monthly token cap and this month's usage. Keys are
// write-only: the page only ever shows their last four characters.

const KINDS: AiKind[] = ['anthropic', 'openai', 'local'];
const FEATURES: AiFeature[] = ['digest', 'summaries', 'ask'];
const FEATURE_HELP: Record<AiFeature, string> = {
  digest: 'A few sentences at the top of the Brief, each citing its events. Refreshed hourly when someone opens it.',
  summaries: 'A button in an event’s panel: one neutral paragraph from its sources, translated.',
  ask: 'Questions about what Argus holds, answered with read-only tools over its data.',
};
const MODEL_HINT: Record<AiKind, string> = {
  anthropic: 'claude-opus-5-5 (best), claude-sonnet-5-5 (cheaper), claude-haiku-5-5 (fastest)',
  openai: 'Any chat model your key can use',
  local: 'The model name on your server, e.g. llama3.1:8b or qwen2.5:14b',
};

type Draft = {
  providers: Record<AiKind, { key: string; keep: boolean; model: string; base_url: string }>;
  features: Record<AiFeature, { on: boolean; provider: AiKind; model: string }>;
  monthly_tokens: number;
};

function draftFrom(s: AiSettings): Draft {
  return {
    providers: Object.fromEntries(
      KINDS.map((k) => [k, { key: '', keep: true, model: s.providers[k].model, base_url: s.providers[k].base_url }]),
    ) as Draft['providers'],
    features: Object.fromEntries(
      FEATURES.map((f) => [f, { on: s.features[f].on, provider: s.features[f].provider, model: s.features[f].model }]),
    ) as Draft['features'],
    monthly_tokens: s.monthly_tokens,
  };
}

export default function AiSection() {
  const [s, setS] = useState<AiSettings | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [status, setStatus] = useState('');
  const [tests, setTests] = useState<Partial<Record<AiKind, string>>>({});

  useEffect(() => {
    getAiSettings()
      .then((r) => {
        setS(r);
        setD(draftFrom(r));
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load.'));
  }, []);

  if (!s || !d) return <p className="quiet small pad">{status || 'Loading…'}</p>;

  const setP = (k: AiKind, patch: Partial<Draft['providers'][AiKind]>) =>
    setD({ ...d, providers: { ...d.providers, [k]: { ...d.providers[k], ...patch } } });
  const setF = (f: AiFeature, patch: Partial<Draft['features'][AiFeature]>) =>
    setD({ ...d, features: { ...d.features, [f]: { ...d.features[f], ...patch } } });

  async function save() {
    if (!d) return;
    setStatus('Saving…');
    try {
      const r = await putAiSettings({
        providers: Object.fromEntries(
          KINDS.map((k) => {
            const p = d.providers[k];
            return [k, { key: p.keep ? null : p.key, model: p.model, base_url: p.base_url }];
          }),
        ),
        features: d.features,
        monthly_tokens: d.monthly_tokens,
      });
      setS({ ...r, usage: s?.usage });
      setD(draftFrom(r));
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  async function test(k: AiKind) {
    setTests({ ...tests, [k]: 'Testing…' });
    try {
      const r = await testAi(k);
      setTests((t) => ({
        ...t,
        [k]: r.ok ? 'Works: ' + r.model + ' replied “' + r.reply + '” in ' + r.seconds + ' s' : r.error,
      }));
    } catch (err) {
      setTests((t) => ({ ...t, [k]: err instanceof Error ? err.message : 'Failed.' }));
    }
  }

  const used = Object.values(s.usage ?? {}).reduce((n, p) => n + p.input + p.output, 0);
  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Providers</h2>
        </div>
        <div className="cbody">
          <p className="quiet small">
            Argus works fully without AI. Add a provider to turn features on below. Keys are stored encrypted and are
            never shown again; save first, then <b>Test</b> sends a one-word prompt. Nothing is sent to a cloud provider
            unless you set one up here; a local server keeps everything on your hardware.
          </p>
        </div>
        <div className="srows">
          {KINDS.map((k) => {
            const p = d.providers[k];
            const saved = s.providers[k];
            return (
              <div key={k} className="srow col aiprov">
                <span className="srow-label">
                  <b>{PROVIDER_LABEL[k]}</b>
                  <small>{MODEL_HINT[k]}</small>
                </span>
                <div className="aigrid">
                  {k === 'local' && (
                    <label className="field">
                      <span>Base URL</span>
                      <input
                        value={p.base_url}
                        placeholder="http://ollama:11434/v1"
                        onChange={(e) => setP(k, { base_url: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="field">
                    <span>API key{k === 'local' ? ' (if your server needs one)' : ''}</span>
                    {p.keep && saved.key_hint ? (
                      <span className="keyset">
                        <span className="mono">{saved.key_hint}</span>
                        <button className="btn small" onClick={() => setP(k, { keep: false, key: '' })}>
                          Change or remove
                        </button>
                      </span>
                    ) : (
                      <input
                        type="password"
                        autoComplete="off"
                        value={p.key}
                        placeholder={saved.key_hint ? 'Leave empty to remove the key' : 'Paste the key'}
                        onChange={(e) => setP(k, { key: e.target.value, keep: false })}
                      />
                    )}
                  </label>
                  <label className="field">
                    <span>Default model</span>
                    <input value={p.model} onChange={(e) => setP(k, { model: e.target.value })} />
                  </label>
                  <span className="rowbtns">
                    <button className="btn small" disabled={!saved.configured} onClick={() => void test(k)}>
                      Test
                    </button>
                  </span>
                </div>
                {tests[k] && <p className="quiet small">{tests[k]}</p>}
              </div>
            );
          })}
        </div>
      </section>
      <section className="card">
        <div className="ph">
          <h2>Features</h2>
        </div>
        <div className="srows">
          {FEATURES.map((f) => (
            <div key={f} className="srow">
              <span className="srow-label">
                <b>{s.features[f].label}</b>
                <small>{FEATURE_HELP[f]}</small>
              </span>
              <span className="aifeat">
                <span className="lrow flat">
                  <input
                    type="checkbox"
                    aria-label={'Turn on ' + s.features[f].label}
                    checked={d.features[f].on}
                    onChange={(e) => setF(f, { on: e.target.checked })}
                  />
                  <span className="tog" />
                </span>
                <select
                  value={d.features[f].provider}
                  aria-label="Provider"
                  onChange={(e) => setF(f, { provider: e.target.value as AiKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PROVIDER_LABEL[k]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Model for this feature"
                  placeholder={'Model: ' + (d.providers[d.features[f].provider].model || 'provider default')}
                  value={d.features[f].model}
                  onChange={(e) => setF(f, { model: e.target.value })}
                />
              </span>
            </div>
          ))}
          <div className="srow">
            <span className="srow-label">
              <b>Monthly token cap</b>
              <small>Features stop for the rest of the month once this many tokens (in and out) are used</small>
            </span>
            <input
              type="number"
              min={10000}
              step={100000}
              value={d.monthly_tokens}
              onChange={(e) => setD({ ...d, monthly_tokens: Math.max(10000, Number(e.target.value) || 10000) })}
            />
          </div>
          <div className="srow">
            <span className="quiet small">{status}</span>
            <button className="btn primary" onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="ph">
          <h2>This month</h2>
          <span className="mono">
            {used.toLocaleString()} / {s.monthly_tokens.toLocaleString()} tokens
          </span>
        </div>
        <div className="cbody tblwrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Calls</th>
                <th>Tokens in</th>
                <th>Tokens out</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.usage ?? {}).map(([k, u]) => (
                <tr key={k}>
                  <td>{PROVIDER_LABEL[k as AiKind] ?? k}</td>
                  <td className="mono">{u.calls}</td>
                  <td className="mono">{u.input.toLocaleString()}</td>
                  <td className="mono">{u.output.toLocaleString()}</td>
                </tr>
              ))}
              {!Object.keys(s.usage ?? {}).length && (
                <tr>
                  <td colSpan={4} className="quiet">
                    Nothing used yet this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
