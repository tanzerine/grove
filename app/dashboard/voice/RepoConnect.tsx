'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * GitHub repo connection for the Brand voice page. Reading the product's own
 * repo (README, docs/) gives the pipeline real features and real steps —
 * which unlocks step-by-step tutorials and feature deep-dives.
 */
export default function RepoConnect({
  domainId, repo, syncedAt,
}: { domainId: string; repo: string | null; syncedAt: string | null }) {
  const r = useRouter();
  const [input, setInput] = useState(repo ?? '');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function sync() {
    setBusy('sync');
    setErr(null);
    try {
      const res = await fetch('/api/domains/repo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: domainId,
          repo: input.trim() || undefined,
          token: token.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
      } else {
        setToken('');
        r.refresh();
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setErr(null);
    try {
      const res = await fetch(`/api/domains/repo?id=${domainId}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
      } else {
        setInput('');
        r.refresh();
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          className="mono"
          style={{
            flex: '1 1 260px', fontSize: 13, padding: '9px 12px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)', background: 'var(--paper)', color: 'inherit',
          }}
        />
        <button className="btn btn-primary btn-sm" onClick={sync} disabled={!!busy || !input.trim()}>
          {busy === 'sync' ? 'Reading repo…' : repo ? 'Re-sync' : 'Connect & read'}
        </button>
        {repo && (
          <button className="btn btn-sm" onClick={disconnect} disabled={!!busy}>
            {busy === 'disconnect' ? '…' : 'Disconnect'}
          </button>
        )}
      </div>

      {showToken ? (
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="github_pat_… (fine-grained token, read-only Contents)"
          className="mono"
          style={{
            fontSize: 13, padding: '9px 12px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)', background: 'var(--paper)', color: 'inherit',
          }}
        />
      ) : (
        <button
          onClick={() => setShowToken(true)}
          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 12, color: 'var(--clay)', textDecoration: 'underline' }}
        >
          Private repo? Add an access token
        </button>
      )}

      {syncedAt && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--clay)' }}>
          last read {new Date(syncedAt).toLocaleString('en-US')}
        </div>
      )}
      {err && (
        <div style={{ background: '#fdecec', border: '1px solid #f5b5b5', color: '#a33', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
          {err}
        </div>
      )}
    </div>
  );
}
