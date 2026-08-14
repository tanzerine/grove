'use client';
/**
 * "You already have a blog" — the MCP path.
 *
 * The embed above this card renders grove's markup inside a page. This card is
 * for the customer that card can't help: the one with a real content layer —
 * their own /blog route, their own card components, their own MDX pipeline —
 * who wants grove's articles INSIDE it, in their own design, at their own URLs.
 * They point their coding agent at grove's MCP server and it writes the files.
 *
 * The panel does three things and no more: mint a key, show the snippet that
 * uses it, and say plainly what the agent will be able to do. The token is
 * readable exactly once — the moment it's created — so the snippet is rendered
 * with the real key only in that window and with a placeholder afterwards.
 */
import { useCallback, useEffect, useState } from 'react';
import CopySnippet from './CopySnippet';
import Icon from '../gv-icons';

type KeyRow = {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const PLACEHOLDER = 'grove_mcp_your_key_here';

export default function McpPanel({
  domainId,
  groveBase,
  hostname,
}: {
  domainId: string | null;
  groveBase: string;
  hostname: string;
}) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!domainId) return setKeys([]);
    const res = await fetch(`/api/mcp/keys?domain_id=${domainId}`).catch(() => null);
    const body = await res?.json().catch(() => null);
    setKeys(body?.keys ?? []);
  }, [domainId]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!domainId) return;
    setBusy(true);
    setError('');
    const res = await fetch('/api/mcp/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.token) {
      setFresh(body.token);
      await load();
    } else {
      setError(body?.message ?? body?.error ?? 'could not create a key — try again');
    }
    setBusy(false);
  }

  async function revoke(id: string) {
    setBusy(true);
    await fetch(`/api/mcp/keys/${id}`, { method: 'DELETE' }).catch(() => null);
    await load();
    setBusy(false);
  }

  const token = fresh ?? PLACEHOLDER;
  const url = `${groveBase}/api/mcp`;
  const cli = `claude mcp add --transport http grove ${url} --header "Authorization: Bearer ${token}"`;
  const json = JSON.stringify(
    { mcpServers: { grove: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
    null, 2,
  );
  const live = (keys ?? []).filter((k) => !k.revoked_at);

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>
        Or · you already have a blog
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>
        Put grove&rsquo;s articles inside your own content layer
      </div>
      <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 640 }}>
        If {hostname.replace(/^www\./, '')} already has a blog — its own route, its own components, its own MDX or CMS —
        you don&rsquo;t want an embed. Connect grove to your coding agent instead: it reads what we&rsquo;ve published,
        writes the files in <em>your</em> shape, and points every canonical URL at your pages.
      </p>

      {/* ── the key ───────────────────────────────────────────────── */}
      <div style={{ padding: '16px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: live.length || fresh ? 12 : 0 }}>
          <div style={{ fontSize: 12.5, color: 'var(--gv-soft)', fontWeight: 600 }}>API key</div>
          <button
            type="button"
            onClick={create}
            disabled={busy || !domainId}
            style={{
              padding: '7px 14px', borderRadius: 9, border: 'none', background: 'var(--gv-accent)',
              color: 'var(--gv-on-accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              opacity: busy || !domainId ? 0.6 : 1,
            }}
          >
            {busy ? 'Working…' : live.length ? 'New key' : 'Create key'}
          </button>
        </div>

        {fresh && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(162,255,1,0.07)', border: '1px solid rgba(162,255,1,0.3)', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ display: 'flex', color: 'var(--gv-accent-ink)' }}><Icon name="check" size={14} /></span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#d9ff8f' }}>Copy it now — this is the only time it&rsquo;s shown</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--gv-soft)', wordBreak: 'break-all' }}>{fresh}</code>
              <CopySnippet snippet={fresh} />
            </div>
          </div>
        )}

        {keys === null ? (
          <div style={{ fontSize: 12, color: 'var(--gv-fainter)' }}>Loading…</div>
        ) : live.length === 0 && !fresh ? (
          <div style={{ fontSize: 12, color: 'var(--gv-fainter)' }}>
            No keys yet. The key is scoped to this site only — it can read this blog&rsquo;s articles and set where they&rsquo;re canonical, nothing else.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {live.map((k) => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                <code className="mono" style={{ color: 'var(--gv-soft)' }}>{k.token_prefix}…</code>
                <span style={{ flex: 1, color: 'var(--gv-fainter)', fontSize: 11.5 }}>
                  {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'never used'}
                </span>
                <button
                  type="button"
                  onClick={() => revoke(k.id)}
                  disabled={busy}
                  className="gv-ghost"
                  style={{ border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, padding: '4px 10px', borderRadius: 7, cursor: 'pointer' }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ color: 'var(--gv-red)', fontSize: 12.5, margin: '10px 0 0' }}>{error}</p>}
      </div>

      {/* ── the snippets ──────────────────────────────────────────── */}
      <Snippet
        label="Claude Code — one command, in your site's repo"
        code={cli}
      />
      <Snippet
        label="Cursor, Windsurf, and most other clients — mcp.json"
        code={json}
        note="VS Code puts the same object under `servers` instead of `mcpServers` in .vscode/mcp.json."
      />

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 10 }}>Then ask it to integrate. What it can do:</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.7 }}>
          <li>List and read every published article — as MDX, markdown, ready-made HTML, or raw JSON parts</li>
          <li>Work out what changed since last time, so a re-sync rewrites what moved and leaves the rest alone</li>
          <li>Hand you the analytics beacon, so reads from your pages still feed next month&rsquo;s plan</li>
          <li>Point every canonical, sitemap entry, RSS item and social link at your URLs instead of grove&rsquo;s mirror</li>
        </ul>
        <p style={{ fontSize: 12.5, color: 'var(--gv-faint)', margin: '12px 0 0', lineHeight: 1.55 }}>
          It cannot generate, edit, publish or delete anything — the key reads this blog and sets that one URL.
        </p>
      </div>
    </div>
  );
}

function Snippet({ label, code, note }: { label: string; code: string; note?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>{label}</div>
        <CopySnippet snippet={code} />
      </div>
      <pre
        className="mono"
        style={{
          margin: 0, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)', color: 'var(--gv-soft)', fontSize: 11.5,
          lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre',
        }}
      >{code}</pre>
      {note && <p style={{ fontSize: 11.5, color: 'var(--gv-fainter)', margin: '6px 0 0', lineHeight: 1.5 }}>{note}</p>}
    </div>
  );
}
