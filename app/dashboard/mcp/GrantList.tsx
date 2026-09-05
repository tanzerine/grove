'use client';
/**
 * The agents a customer approved in a browser, and the button that cuts one off.
 *
 * Separate from KeyManager on purpose. A key is something the customer made and
 * pasted; a grant is something they approved and can withdraw. They authenticate
 * identically downstream, but the questions they answer are different — "what
 * did I hand out?" versus "what did I let in?" — and one list mixing both would
 * answer neither.
 */
import { useState } from 'react';
import Icon from '../gv-icons';
import { useT } from '../i18n';
import type { GrantView } from '@/lib/mcp/grants';

export default function GrantList({ initial }: { initial: GrantView[] }) {
  const t = useT();
  const [grants, setGrants] = useState<GrantView[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(clientId: string) {
    setBusy(clientId);
    setError(null);
    try {
      const res = await fetch(`/api/oauth/grants/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(t('Could not disconnect that agent. Try again.'));
        return;
      }
      setGrants((gs) => gs.map((g) => (g.clientId === clientId ? { ...g, active: false, expiresAt: null } : g)));
      setConfirming(null);
    } catch {
      setError(t('Could not reach grove. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{t('Connected agents')}</div>
      <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', lineHeight: 1.55, margin: '0 0 16px', maxWidth: 620 }}>
        {t('Approved in a browser, not pasted from here. Disconnecting one stops its access immediately, including any refresh token it still holds.')}
      </p>

      {error && <p style={{ fontSize: 12.5, color: '#ff8f6b', margin: '0 0 12px' }}>{error}</p>}

      {!grants.length ? (
        <p style={{ fontSize: 13, color: 'var(--gv-faint)', margin: 0 }}>
          {t('Nothing connected yet. An agent appears here after you approve it in the browser.')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grants.map((g) => {
            const dead = !g.active;
            const asking = confirming === g.clientId;
            return (
              <div
                key={g.clientId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 10,
                  background: asking ? 'rgba(255,155,155,0.07)' : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${asking ? 'rgba(255,155,155,0.34)' : 'rgba(255,255,255,0.06)'}`,
                  opacity: dead ? 0.5 : 1, flexWrap: 'wrap',
                }}
              >
                <span style={{ display: 'flex', color: dead ? 'var(--gv-fainter)' : 'var(--gv-accent-ink)' }}>
                  <Icon name={dead ? 'x' : 'check'} size={15} />
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gv-soft)' }}>
                    {g.name}
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gv-fainter)', marginLeft: 8 }}>
                      {g.canWrite ? t('read + write') : t('read only')}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--gv-fainter)', marginTop: 3 }}>
                    {/* Connected date first: it is the fact a customer auditing
                        this list is actually looking for. */}
                    {t('connected')} {g.connectedLabel}
                    {'  ·  '}{g.calls} {g.calls === 1 ? t('call') : t('calls')}
                    {'  ·  '}{t('last used')} {g.lastUsedLabel}
                    {g.lastTool ? ` (${g.lastTool})` : ''}
                    {g.rotations > 0 ? `  ·  ${t('refreshed')} ${g.rotations}×` : ''}
                  </div>
                </div>

                {dead ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gv-fainter)' }}>{t('Disconnected')}</span>
                ) : asking ? (
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--gv-soft)' }}>{t('Cut off access?')}</span>
                    <button
                      onClick={() => disconnect(g.clientId)}
                      disabled={busy === g.clientId}
                      style={{ border: '1px solid rgba(255,155,155,0.5)', background: 'rgba(255,155,155,0.12)', color: '#ff9b9b', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 7, cursor: 'pointer' }}
                    >
                      {busy === g.clientId ? t('Disconnecting…') : t('Yes, disconnect')}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="gv-ghost"
                      style={{ border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer' }}
                    >
                      {t('Keep')}
                    </button>
                  </span>
                ) : (
                  // Two steps, because this one is not undoable: the agent has to
                  // be re-approved in a browser to come back.
                  <button
                    onClick={() => { setConfirming(g.clientId); setError(null); }}
                    className="gv-ghost"
                    style={{ border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer' }}
                  >
                    {t('Disconnect')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
