'use client';
export const dynamic = 'force-dynamic';
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
  const [tab, setTab] = useState<'dns' | 'meta' | 'file'>('dns');

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
    else setMsg(j.reason ?? 'Not verified yet — try again in a minute.');
  }

  if (!d) return <main className="wrap" style={{ padding: 60 }}>Loading…</main>;

  const token = d.verify_token;
  const fileUrl = `https://${d.hostname}/.well-known/grove-verify.txt`;
  const metaTag = `<meta name="grove-verify" content="${token}">`;

  return (
    <main className="wrap" style={{ maxWidth: 780, padding: '60px 28px' }}>
      <span className="eyebrow">Step 2 of 2</span>
      <h1 className="display" style={{ fontSize: 36, marginTop: 10 }}>
        Verify ownership of <span className="mono" style={{ color: 'var(--moss)' }}>{d.hostname}</span>
      </h1>
      <p className="lede">
        Pick whichever method is easiest. You only need to do <b>one</b>.
        We check all three automatically.
      </p>

      <div className="tabs" style={{ flexDirection: 'row', marginTop: 24, gap: 8 }}>
        <button className={`tab ${tab === 'dns' ? 'on' : ''}`} onClick={() => setTab('dns')}>
          🛡️ DNS record <small style={{ color: 'var(--moss)' }}>recommended</small>
        </button>
        <button className={`tab ${tab === 'meta' ? 'on' : ''}`} onClick={() => setTab('meta')}>
          🏷️ Meta tag
        </button>
        <button className={`tab ${tab === 'file' ? 'on' : ''}`} onClick={() => setTab('file')}>
          📄 File upload
        </button>
      </div>

      {tab === 'dns' && (
        <div style={{ marginTop: 20 }}>
          <p><b>Where:</b> your DNS provider (Cloudflare, Namecheap, GoDaddy, Vercel domains).</p>
          <p><b>Why recommended:</b> works with any website setup — even sites behind auth (Clerk, Auth0), Cloudflare Access, or proprietary CMS.</p>
          <div className="mini" style={{ marginTop: 12 }}>
            <table style={{ width: '100%', fontFamily: 'DM Mono', fontSize: 13 }}>
              <tbody>
                <tr><td style={{ color: 'var(--clay)', paddingRight: 16 }}>Type</td><td>TXT</td></tr>
                <tr><td style={{ color: 'var(--clay)', paddingRight: 16 }}>Name / Host</td><td>@ &nbsp; <span style={{ color: 'var(--clay)' }}>(or your apex domain)</span></td></tr>
                <tr><td style={{ color: 'var(--clay)', paddingRight: 16 }}>Value</td><td>grove-verify={token}</td></tr>
                <tr><td style={{ color: 'var(--clay)', paddingRight: 16 }}>TTL</td><td>Auto / 3600</td></tr>
              </tbody>
            </table>
          </div>
          <p className="lede" style={{ fontSize: 13, marginTop: 12 }}>
            Propagation is usually under a minute. Up to 24h in rare cases.
          </p>
        </div>
      )}

      {tab === 'meta' && (
        <div style={{ marginTop: 20 }}>
          <p><b>Where:</b> the <code className="mono">&lt;head&gt;</code> of your homepage HTML.</p>
          <p><b>Why:</b> one line of code. Survives most auth setups because homepages are public.</p>
          <div className="mini" style={{ marginTop: 12 }}>
            <code className="mono" style={{ fontSize: 13 }}>{metaTag}</code>
          </div>
          <p className="lede" style={{ fontSize: 13, marginTop: 12 }}>
            Verify it lives at <span className="mono">https://{d.hostname}/</span> in the page source (right click → View Page Source).
          </p>
        </div>
      )}

      {tab === 'file' && (
        <div style={{ marginTop: 20 }}>
          <p><b>Where:</b> upload a plain-text file to your site root.</p>
          <p><b>Heads up:</b> some auth middleware (Clerk, NextAuth) protects this path by default. Use DNS or meta tag if you hit issues.</p>
          <div className="mini" style={{ marginTop: 12 }}>
            <div>Path: <span className="mono">{fileUrl}</span></div>
            <div style={{ marginTop: 6 }}>Contents (exactly):</div>
            <code className="mono" style={{ fontSize: 13 }}>{token}</code>
          </div>
        </div>
      )}

      <button className="btn btn-primary" onClick={check} disabled={polling} style={{ marginTop: 32 }}>
        {polling ? 'Checking all methods…' : 'I added it — verify now'}
      </button>
      {msg && <p style={{ marginTop: 14, color: 'var(--clay)', fontSize: 14 }}>{msg}</p>}

      <p style={{ marginTop: 26, fontSize: 14, color: 'var(--clay)' }}>
        Don't have DNS access right now?{' '}
        <a href="/dashboard" style={{ color: 'var(--moss)', textDecoration: 'underline' }}>
          Skip for now →
        </a>{' '}
        You can already queue topics and watch Grove write — autopilot publishing stays
        paused until you verify.
      </p>
    </main>
  );
}

export default function Page() {
  return <Suspense><VerifyInner /></Suspense>;
}
