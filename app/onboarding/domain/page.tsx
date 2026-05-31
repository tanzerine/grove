'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function OnboardInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [host, setHost] = useState(sp.get('domain') ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch('/api/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: host }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? 'Failed to create domain');
    }
    const { id } = await res.json();
    router.replace(`/onboarding/verify?domain=${id}`);
  }

  return (
    <main className="wrap" style={{ maxWidth: 520, padding: '80px 28px' }}>
      <span className="eyebrow">Step 1 of 2</span>
      <h1 className="display" style={{ fontSize: 44, marginTop: 10 }}>Enter your domain</h1>
      <p className="lede">One field. We&apos;ll handle the rest.</p>
      <form onSubmit={go} className="domain-field" style={{ marginTop: 24 }}>
        <span className="pre">https://</span>
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="yourdomain.com" />
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? '…' : 'Continue →'}</button>
      </form>
      {err && <p style={{ color: '#c33', fontSize: 13, marginTop: 12 }}>{err}</p>}
    </main>
  );
}

export default function Page() {
  return <Suspense><OnboardInner /></Suspense>;
}
