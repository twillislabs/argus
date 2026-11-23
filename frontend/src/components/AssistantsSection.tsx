import { useEffect, useState } from 'react';

import { api } from '../lib/api';

// Settings › AI assistants: read-only API tokens, and how to connect an
// assistant that speaks MCP (Claude Code, Claude Desktop and others) to
// Argus's MCP server at /api/mcp.

interface TokenRow {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'never';

export default function AssistantsSection() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const url = window.location.origin + '/api/mcp';
  const load = () =>
    api<{ tokens: TokenRow[] }>('/api/me/tokens')
      .then((r) => setRows(r.tokens))
      .catch((err) => setStatus(err instanceof Error ? err.message : 'Could not load your tokens.'));
  useEffect(() => {
    void load();
  }, []);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<TokenRow & { token: string }>('/api/me/tokens', { method: 'POST', body: { name } });
      setMade({ name: r.name, token: r.token });
      setName('');
      setStatus('');
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not make a token.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: TokenRow) {
    if (!window.confirm('Revoke ' + row.name + '? Anything using it stops working straight away.')) return;
    try {
      await api('/api/me/tokens/' + row.id, { method: 'DELETE' });
      if (made && made.name === row.name) setMade(null);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not revoke it.');
    }
  }

  const token = made?.token ?? '<your token>';
  return (
    <>
      <section className="card">
        <div className="ph">
          <h2>Make a token</h2>
        </div>
        <form className="cbody" onSubmit={(e) => void make(e)}>
          <p className="quiet small">
            A token lets an AI assistant or a script read what Argus shows you: events, the situation, weather,
            aircraft, ships, cameras and news. It can&apos;t change anything, and it can&apos;t read accounts, settings
            or admin pages. Name it for where it&apos;ll be used.
          </p>
          <div className="pairform two">
            <div className="field">
              <label htmlFor="tok-name">Name</label>
              <input
                id="tok-name"
                value={name}
                maxLength={80}
                placeholder="Claude on my laptop"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <button className="btn primary" disabled={busy || !name.trim()}>
              Make token
            </button>
          </div>
          {made && (
            <div className="tokenshow">
              <p className="small">
                <b>{made.name}</b>: copy it now. Argus keeps only a fingerprint of it, so it can&apos;t show it again.
              </p>
              <code className="mono">{made.token}</code>
              <button
                type="button"
                className="btn small"
                onClick={() => void navigator.clipboard?.writeText(made.token)}
              >
                Copy
              </button>
            </div>
          )}
          {status && <p className="err small">{status}</p>}
        </form>
      </section>

      <section className="card">
        <div className="ph">
          <h2>Your tokens</h2>
        </div>
        <div className="cbody">
          {rows.length === 0 ? (
            <p className="quiet small">No tokens yet.</p>
          ) : (
            <ul className="tokenlist">
              {rows.map((r) => (
                <li key={r.id}>
                  <span>
                    <b>{r.name}</b>
                    <small className="quiet">
                      made {when(r.created_at)} · last used {when(r.last_used_at)}
                    </small>
                  </span>
                  <button className="btn small danger" onClick={() => void revoke(r)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <div className="ph">
          <h2>Connect an assistant (MCP)</h2>
        </div>
        <div className="cbody">
          <p className="quiet small">
            Argus has an MCP server at <span className="mono">{url}</span>. Assistants that speak MCP can use its tools:
            the situation, events, search, weather and air quality, military aircraft, ships, traffic cameras and news.
          </p>
          <h3 className="small">Claude Code</h3>
          <pre className="mono codeblock">
            claude mcp add --transport http argus {url} --header &quot;Authorization: Bearer {token}&quot;
          </pre>
          <h3 className="small">Claude Desktop and others (through mcp-remote)</h3>
          <pre className="mono codeblock">
            {JSON.stringify(
              {
                mcpServers: {
                  argus: {
                    command: 'npx',
                    args: ['mcp-remote', url, '--header', 'Authorization: Bearer ' + token],
                  },
                },
              },
              null,
              2,
            )}
          </pre>
          <p className="quiet small">
            The assistant sends what it reads from Argus to its own provider, like anything else in a conversation.
          </p>
        </div>
      </section>
    </>
  );
}
