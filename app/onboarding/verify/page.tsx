'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Domain = { id: string; hostname: string; verify_token: string; verified_at: string | null };

function VerifyInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const id = sp.get('domain')!;
  const [d, setD] = useState<Domain | null>(null);
  const [polling, setPolling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/domains?id=${id}`).then((r) => r.json()).then(setD);
  }, [id]);

  async function check() {
    setPolling(true);
    setMsg(null);
    const r = await fetch('/api/domains/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
    });
    const j = await r.json();
    setPolling(false);
    if (j.ok) router.replace('/dashboard');
    else setMsg(j.reason ?? 'Not verified yet — DNS can take a moment.');
  }

  if (!d) return <main className="wrap" style={{ padding: 60 }}>Loading…</main>;

  const txt = `grove-verify=${d.verify_token}`;
  const fileUrl = `https://${d.hostname}/.well-known/grove-verify.txt`;

  return (
    <main className="wrap" style={{ maxWidth: 760, padding: '60px 28px' }}>
      <span className="eyebrow">Step 2 of 2</span>
      <h1 className="display" style={{ fontSize: 40, marginTop: 10 }}>Prove ownership of <span className="mono" style={{ color: 'var(--moss)' }}>{d.hostname}</span></h1>

      <h3 style={{ marginTop: 30 }}>Option A — DNS TXT record</h3>
      <div className="mini">
        <div className="mini-rec"><span className="k">TXT</span><span className="mono">{d.hostname}</span> &nbsp;{txt}</div>
      </div>
      <p className="lede" style={{ fontSize: 14 }}>Add a TXT record on the apex (or <span className="mono">_grove.{d.hostname}</span>). Propagation: usually under a minute.</p>

      <h3 style={{ marginTop: 30 }}>Option B — Verification file</h3>
      <div className="mini">
        <div className="mini-rec mono">{fileUrl}</div>
      </div>
      <p className="lede" style={{ fontSize: 14 }}>Drop a plain-text file containing exactly: <code className="mono">{d.verify_token}</code></p>

      <button className="btn btn-primary" onClick={check} disabled={polling} style={{ marginTop: 24 }}>
        {polling ? 'Checking…' : 'I added it — verify now'}
      </button>
      {msg && <p style={{ marginTop: 14, color: 'var(--clay)', fontSize: 14 }}>{msg}</p>}
    </main>
  );
}

export default function Page() {
  return <Suspense><VerifyInner /></Suspense>;
}
