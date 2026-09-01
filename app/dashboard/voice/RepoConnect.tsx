'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '../i18n';

/**
 * GitHub repo connection for the Brand voice page. Reading the product's own
 * repo (README, docs/) gives the pipeline real features and real steps —
 * which unlocks step-by-step tutorials and feature deep-dives.
 */
export default function RepoConnect({
  domainId, repo, syncedAt,
}: { domainId: string; repo: string | null; syncedAt: string | null }) {
  const t = useT();
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
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)',
          }}
        />
        <button className="gv-btn" onClick={sync} disabled={!!busy || !input.trim()}
          style={{ border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 9, cursor: 'pointer', opacity: !!busy || !input.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
          {busy === 'sync' ? 'Reading repo…' : repo ? 'Re-sync' : 'Connect & read'}
        </button>
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
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)',
          }}
        />
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {syncedAt && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--gv-faint)' }}>{t('last read')} {new Date(syncedAt).toLocaleString('en-US')}</span>
        )}
        {repo && (
          <button onClick={disconnect} disabled={!!busy} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: 'var(--gv-faint)' }}>
            {busy === 'disconnect' ? '…' : 'Disconnect'}
          </button>
        )}
        {!showToken && (
          <button
            onClick={() => setShowToken(true)}
            style={{ marginLeft: syncedAt || repo ? 'auto' : undefined, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--gv-fainter)', textDecoration: 'underline' }}
          >
            {t('Add access token')}
          </button>
        )}
      </div>

      {err && (
        <div style={{ background: 'rgba(201,79,79,0.08)', border: '1px solid rgba(201,79,79,0.3)', color: 'var(--gv-red-text)', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
          {err}
        </div>
      )}
    </div>
  );
}
