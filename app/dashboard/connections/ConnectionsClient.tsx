'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export type PlatformView = {
  id: 'x' | 'linkedin' | 'instagram';
  configured: boolean;
  connection: { account_handle: string | null; connected_at: string } | null;
};

const META: Record<PlatformView['id'], { label: string; blurb: string; color: string }> = {
  x:         { label: 'X',         blurb: 'Auto-posts a hook + link when an article publishes.', color: '#000000' },
  linkedin:  { label: 'LinkedIn',  blurb: 'Shares the article as a LinkedIn post on your profile.', color: '#0A66C2' },
  instagram: { label: 'Instagram', blurb: 'Posts the cover image + caption (needs an IG Business account).', color: '#C13584' },
};

export default function ConnectionsClient({
  domainId, autoSocial, platforms,
}: { domainId: string; autoSocial: boolean; platforms: PlatformView[] }) {
  const r = useRouter();
  const q = useSearchParams();
  const [auto, setAuto] = useState(autoSocial);
  const [busy, setBusy] = useState<string | null>(null);

  const connectedCount = platforms.filter((p) => p.connection).length;
  const connectedMsg = q.get('connected');
  const errorMsg = q.get('error');

  async function toggleAuto() {
    const next = !auto;
    setAuto(next);
    await fetch('/api/domains/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, auto_social: next }),
    });
    r.refresh();
  }

  async function disconnect(pf: string) {
    setBusy(pf);
    await fetch(`/api/social/${pf}/disconnect`, { method: 'POST' });
    setBusy(null);
    r.refresh();
  }

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h4 style={{ fontFamily: 'Clash Display', fontSize: 28, margin: 0 }}>Social accounts</h4>
        <p style={{ fontSize: 14, color: 'var(--clay)', marginTop: 6, maxWidth: 560 }}>
          Connect your accounts and Grove will automatically share each article when it publishes —
          using the channel-native copy it already writes for every post.
        </p>
      </div>

      {connectedMsg && (
        <Banner ok>Connected {META[connectedMsg as PlatformView['id']]?.label ?? connectedMsg}.</Banner>
      )}
      {errorMsg && (
        <Banner>
          {errorMsg === 'not_configured'
            ? 'That platform isn\'t set up yet — add its API credentials in the environment.'
            : errorMsg === 'state_mismatch'
            ? 'Connection expired or was tampered with. Try again.'
            : `Couldn't connect (${errorMsg}). Try again.`}
        </Banner>
      )}

      {/* auto-share toggle */}
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: 20, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Auto-share on publish</div>
          <div style={{ fontSize: 13, color: 'var(--clay)', marginTop: 2 }}>
            {connectedCount === 0
              ? 'Connect at least one account to enable.'
              : `When on, every published post is shared to your ${connectedCount} connected ${connectedCount === 1 ? 'account' : 'accounts'}.`}
          </div>
        </div>
        <button
          onClick={toggleAuto}
          disabled={connectedCount === 0}
          aria-pressed={auto}
          style={{
            width: 50, height: 28, borderRadius: 999, border: 'none', position: 'relative',
            cursor: connectedCount === 0 ? 'not-allowed' : 'pointer',
            background: auto && connectedCount > 0 ? 'var(--moss)' : 'var(--line)',
            transition: 'background .15s', opacity: connectedCount === 0 ? 0.5 : 1,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: auto ? 25 : 3, width: 22, height: 22,
            borderRadius: '50%', background: 'white', transition: 'left .15s',
          }} />
        </button>
      </div>

      {/* platform cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {platforms.map((p) => {
          const m = META[p.id];
          return (
            <div key={p.id} style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: m.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'Clash Display', flexShrink: 0 }}>
                {m.label[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 13, color: 'var(--clay)', marginTop: 2 }}>
                  {p.connection
                    ? <>Connected{p.connection.account_handle ? ` as ${p.connection.account_handle}` : ''}.</>
                    : m.blurb}
                </div>
              </div>
              {!p.configured ? (
                <span style={{ fontSize: 12, color: 'var(--clay)', fontFamily: 'DM Mono' }}>not set up</span>
              ) : p.connection ? (
                <button onClick={() => disconnect(p.id)} disabled={busy === p.id} className="btn btn-ghost btn-sm">
                  {busy === p.id ? '…' : 'Disconnect'}
                </button>
              ) : (
                <a href={`/api/social/${p.id}/connect`} className="btn btn-primary btn-sm">Connect</a>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--clay)', marginTop: 16 }}>
        Tokens are encrypted at rest. Disconnect any time — Grove keeps no copy after that.
      </p>
    </div>
  );
}

function Banner({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div style={{
      background: ok ? 'rgba(89,148,94,0.10)' : '#fdecea',
      border: `1px solid ${ok ? 'var(--moss)' : '#e6a89f'}`,
      color: ok ? 'var(--moss)' : '#b04a3b',
      borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16,
    }}>
      {children}
    </div>
  );
}
