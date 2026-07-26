'use client';
export const dynamic = 'force-dynamic';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GroveMark from '@/components/GroveMark';

function OnboardInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [host, setHost] = useState(sp.get('domain') ?? '');
  const [err, setErr] = useState<string | null>(null);
  // A plan ceiling isn't a typo the customer can fix by retrying — it needs a
  // way forward, so it renders with an upgrade link rather than as a red line.
  const [upsell, setUpsell] = useState<{ name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setUpsell(null);
    setBusy(true);
    const res = await fetch('/api/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: host }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.reason === 'domain_limit' && j.upgradeName) setUpsell({ name: j.upgradeName });
      return setErr(j.error ?? 'Failed to create domain');
    }
    const { id } = await res.json();
    router.replace(`/onboarding/verify?domain=${id}`);
  }

  return (
    <main className="gv-onb">
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden><span className="b1" /><span className="b2" /></div>
      <div className="gv-onb-in" style={{ maxWidth: 520 }}>
        <span className="gv-onb-eyebrow">Step 1 of 2</span>
        <h1 className="gv-onb-title" style={{ fontSize: 'clamp(30px, 8vw, 44px)' }}>Enter your domain</h1>
        <p className="gv-onb-lede">One field. We&apos;ll handle the rest. Use a domain you control &mdash; the next step verifies ownership via DNS or a meta tag.</p>
        <form onSubmit={go} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '6px 6px 6px 14px' }}>
          <span style={{ color: 'var(--gv-faint)', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>https://</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="yourdomain.com"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--gv-ink)', fontSize: 16, padding: '10px 4px', fontFamily: 'inherit' }} />
          <button className="gv-onb-btn" style={{ padding: '10px 16px', fontSize: 14, whiteSpace: 'nowrap' }} disabled={busy}>{busy ? '…' : 'Continue →'}</button>
        </form>
        {err && !upsell && <p style={{ color: 'var(--gv-red-text)', fontSize: 13, marginTop: 12 }}>{err}</p>}
        {upsell && (
          <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
            <p style={{ fontSize: 13.5, color: 'var(--gv-ink)', margin: 0, lineHeight: 1.6 }}>{err}</p>
            <p style={{ fontSize: 12.5, color: 'var(--gv-dim)', margin: '6px 0 0', lineHeight: 1.6 }}>
              Your existing sites keep running. {upsell.name} adds room for this one.
            </p>
            <a href="/dashboard/billing" style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--gv-accent-ink)', textDecoration: 'none' }}>
              See {upsell.name} →
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><OnboardInner /></Suspense>;
}
