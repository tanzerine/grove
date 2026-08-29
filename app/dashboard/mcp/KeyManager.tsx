'use client';
/**
 * Create, show and revoke MCP keys — and, the moment a key exists, hand over
 * the exact command that connects an agent to it.
 *
 * The secret is returned by the API exactly once. That is the whole reason this
 * component holds it in state and pushes it into the snippets below: if the
 * customer has to go and find it later, they can't, and the only recovery is
 * making a second key. So the connect snippets live next to the reveal.
 */
import { useState } from 'react';
import Icon from '../gv-icons';
import CopySnippet from '../embed/CopySnippet';

export type KeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  domain_id: string | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  last_tool: string | null;
  calls: number;
  revoked_at: string | null;
  expires_at: string | null;
  state: 'active' | 'revoked' | 'expired';
};

type Site = { id: string; hostname: string };

const PLACEHOLDER = 'gv_mcp_YOUR_KEY';

function fieldStyle(): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 13,
    padding: '8px 11px', minWidth: 0,
  };
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function KeyManager({ initialKeys, sites, endpoint }: {
  initialKeys: KeyRow[];
  sites: Site[];
  endpoint: string;
}) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [secret, setSecret] = useState<string | null>(null);
  const [name, setName] = useState('Content layer');
  const [siteId, setSiteId] = useState('');
  const [writable, setWritable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = secret ?? PLACEHOLDER;
  const cli = `claude mcp add --transport http grove ${endpoint} --header "Authorization: Bearer ${token}"`;
  const json = JSON.stringify(
    { mcpServers: { grove: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
    null, 2,
  );

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/mcp/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Content layer',
          domain_id: siteId || null,
          scopes: writable ? ['read', 'write'] : ['read'],
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body?.error ?? 'Could not create the key.'); return; }
      setKeys((k) => [body.key, ...k]);
      setSecret(body.secret);
    } catch {
      setError('Could not reach grove. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/mcp/keys/${id}`, { method: 'DELETE' });
      setKeys((ks) => ks.map((k) => (k.id === id ? { ...k, state: 'revoked', revoked_at: new Date().toISOString() } : k)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* ── create ─────────────────────────────────────────────── */}
      <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>Step 1 · Create a key</div>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>One key per agent</div>
        <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 620 }}>
          Shown once, then stored only as a hash — grove can&rsquo;t show it to you again. Revoke and make a new one if it goes missing.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="What is it for?" style={{ ...fieldStyle(), flex: '1 1 200px' }} />
          {sites.length > 1 && (
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={{ ...fieldStyle(), flex: '0 1 200px' }}>
              <option value="">All my sites</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.hostname}</option>)}
            </select>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--gv-dim)', cursor: 'pointer' }}>
            <input type="checkbox" checked={writable} onChange={(e) => setWritable(e.target.checked)} />
            Allow write-back
          </label>
          <button onClick={create} disabled={busy} className="gv-primary"
            style={{ border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--gv-fainter)', lineHeight: 1.5, margin: '10px 0 0', maxWidth: 620 }}>
          Write-back lets the agent record where each article went live and point grove&rsquo;s canonical URLs at your site.
          Without it the key can only read — and grove can&rsquo;t tell which articles you&rsquo;ve already imported.
        </p>
        {error && <p style={{ fontSize: 12.5, color: '#ff8f6b', margin: '10px 0 0' }}>{error}</p>}

        {secret && (
          <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'rgba(162,255,1,0.07)', border: '1px solid rgba(162,255,1,0.32)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#d9ff8f' }}>Copy it now — this is the only time it&rsquo;s shown</span>
              <CopySnippet snippet={secret} />
            </div>
            <code style={{ display: 'block', fontSize: 12, color: 'var(--gv-soft)', fontFamily: "'SF Mono', ui-monospace, monospace", wordBreak: 'break-all' }}>{secret}</code>
          </div>
        )}
      </div>

      {/* ── connect ────────────────────────────────────────────── */}
      <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginBottom: 4 }}>Step 2 · Connect your agent</div>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 6 }}>Point it at grove</div>
        <p style={{ fontSize: 13, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 620 }}>
          Run this in the repository that holds your blog{secret ? '' : ' — the key below is a placeholder until you create one'}.
          Then ask it to <span style={{ color: 'var(--gv-soft)' }}>&ldquo;import the new grove articles&rdquo;</span>.
        </p>

        <Snippet label="Claude Code" body={cli} />
        <div style={{ height: 12 }} />
        <Snippet label="Cursor / Claude Desktop — mcp.json" body={json} />
      </div>

      {/* ── keys ───────────────────────────────────────────────── */}
      <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Your keys</div>
        {!keys.length ? (
          <p style={{ fontSize: 13, color: 'var(--gv-faint)', margin: 0 }}>No keys yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.map((k) => {
              const dead = k.state !== 'active';
              const site = sites.find((s) => s.id === k.domain_id);
              return (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', opacity: dead ? 0.5 : 1 }}>
                  <span style={{ display: 'flex', color: dead ? 'var(--gv-fainter)' : 'var(--gv-accent-ink)' }}>
                    <Icon name={dead ? 'x' : 'check'} size={15} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gv-soft)' }}>
                      {k.name}
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gv-fainter)', marginLeft: 8 }}>
                        {site ? site.hostname : 'all sites'} · {k.scopes?.includes('write') ? 'read + write' : 'read only'}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--gv-fainter)', marginTop: 3 }}>
                      {k.key_prefix}••••••••  ·  {k.calls} call{k.calls === 1 ? '' : 's'}  ·  last used {ago(k.last_used_at)}
                      {k.last_tool ? ` (${k.last_tool})` : ''}
                    </div>
                  </div>
                  {dead ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gv-fainter)' }}>{k.state === 'expired' ? 'Expired' : 'Revoked'}</span>
                  ) : (
                    <button onClick={() => revoke(k.id)} disabled={busy} className="gv-ghost"
                      style={{ border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer' }}>
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function Snippet({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: 'var(--gv-faint)', fontFamily: "'SF Mono', ui-monospace, monospace" }}>{label}</span>
        <CopySnippet snippet={body} />
      </div>
      <pre style={{ margin: 0, padding: '14px 16px', fontSize: 12, lineHeight: 1.6, color: 'var(--gv-soft)', fontFamily: "'SF Mono', ui-monospace, monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0d0e0b' }}>{body}</pre>
    </div>
  );
}
