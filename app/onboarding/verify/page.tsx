'use client';
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GroveMark from '@/components/GroveMark';
import StepView from '../StepView';
import { captureClient } from '@/lib/analytics/capture-client';

type Domain ={ id: string; hostname: string; verify_token: string; verified_at: string | null };

const DIM = 'var(--gv-dim)';
const MONO = 'DM Mono, ui-monospace, monospace';

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
    const via = (j.via ?? null) as 'dns' | 'meta' | 'http' | null;
    captureClient('domain_verify_attempted', { domain_id: id, ok: !!j.ok, via });
    if (j.ok) {
      // `already: true` means the domain was verified on an earlier attempt and
      // this call was a no-op, so counting it would inflate conversions with
      // repeat visits to a page the user has already cleared.
      if (!j.already) {
        captureClient('domain_verified', { domain_id: id, via });
        // Verification is the last required step — everything after it is the
        // dashboard. This is the activation moment worth measuring signup against.
        captureClient('onboarding_completed', { domain_id: id });
      }
      router.replace('/dashboard');
    } else {
      setMsg(j.reason ?? 'Not verified yet — try again in a minute.');
    }
  }

  if (!d) return <main className="gv-onb"><div className="gv-onb-in" style={{ maxWidth: 780, color: DIM }}>Loading…</div></main>;

  const token = d.verify_token;
  const fileUrl = `https://${d.hostname}/.well-known/grove-verify.txt`;
  const metaTag = `<meta name="grove-verify" content="${token}">`;
  const lbl: React.CSSProperties = { color: DIM, paddingRight: 16 };

  return (
    <main className="gv-onb">
      <StepView step="verify" />
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden><span className="b1" /><span className="b2" /></div>
      <div className="gv-onb-in" style={{ maxWidth: 780 }}>
        <span className="gv-onb-eyebrow">Step 2 of 2</span>
        <h1 className="gv-onb-title" style={{ fontSize: 'clamp(26px, 6.5vw, 36px)' }}>
          Verify ownership of <span style={{ fontFamily: MONO, color: 'var(--gv-accent-ink)' }}>{d.hostname}</span>
        </h1>
        <p className="gv-onb-lede">
          Pick whichever method is easiest. You only need to do <b style={{ color: 'var(--gv-ink)' }}>one</b>.
          We check all three automatically.
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap' }}>
          <button className={`gv-onb-tab ${tab === 'dns' ? 'on' : ''}`} onClick={() => setTab('dns')}>
            🛡️ DNS record <small style={{ color: 'var(--gv-accent-ink)' }}>recommended</small>
          </button>
          <button className={`gv-onb-tab ${tab === 'meta' ? 'on' : ''}`} onClick={() => setTab('meta')}>🏷️ Meta tag</button>
          <button className={`gv-onb-tab ${tab === 'file' ? 'on' : ''}`} onClick={() => setTab('file')}>📄 File upload</button>
        </div>

        {tab === 'dns' && (
          <div style={{ marginTop: 20, color: 'var(--gv-soft)', fontSize: 14.5, lineHeight: 1.6 }}>
            <p><b style={{ color: 'var(--gv-ink)' }}>Where:</b> your DNS provider (Cloudflare, Namecheap, GoDaddy, Vercel domains).</p>
            <p><b style={{ color: 'var(--gv-ink)' }}>Why recommended:</b> works with any website setup — even sites behind auth (Clerk, Auth0), Cloudflare Access, or proprietary CMS.</p>
            <div className="gv-onb-mini" style={{ marginTop: 12 }}>
              <table style={{ width: '100%', fontFamily: MONO, fontSize: 13 }}>
                <tbody>
                  <tr><td style={lbl}>Type</td><td>TXT</td></tr>
                  <tr><td style={lbl}>Name / Host</td><td>@ &nbsp; <span style={{ color: DIM }}>(or your apex domain)</span></td></tr>
                  <tr><td style={lbl}>Value</td><td>grove-verify={token}</td></tr>
                  <tr><td style={lbl}>TTL</td><td>Auto / 3600</td></tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 13, marginTop: 12, color: DIM }}>Propagation is usually under a minute. Up to 24h in rare cases.</p>
          </div>
        )}

        {tab === 'meta' && (
          <div style={{ marginTop: 20, color: 'var(--gv-soft)', fontSize: 14.5, lineHeight: 1.6 }}>
            <p><b style={{ color: 'var(--gv-ink)' }}>Where:</b> the <code style={{ fontFamily: MONO }}>&lt;head&gt;</code> of your homepage HTML.</p>
            <p><b style={{ color: 'var(--gv-ink)' }}>Why:</b> one line of code. Survives most auth setups because homepages are public.</p>
            <div className="gv-onb-mini" style={{ marginTop: 12 }}>
              <code style={{ fontFamily: MONO, fontSize: 13 }}>{metaTag}</code>
            </div>
            <p style={{ fontSize: 13, marginTop: 12, color: DIM }}>
              Verify it lives at <span style={{ fontFamily: MONO }}>https://{d.hostname}/</span> in the page source (right click → View Page Source).
            </p>
          </div>
        )}

        {tab === 'file' && (
          <div style={{ marginTop: 20, color: 'var(--gv-soft)', fontSize: 14.5, lineHeight: 1.6 }}>
            <p><b style={{ color: 'var(--gv-ink)' }}>Where:</b> upload a plain-text file to your site root.</p>
            <p><b style={{ color: 'var(--gv-ink)' }}>Heads up:</b> some auth middleware (Clerk, NextAuth) protects this path by default. Use DNS or meta tag if you hit issues.</p>
            <div className="gv-onb-mini" style={{ marginTop: 12 }}>
              <div>Path: <span style={{ fontFamily: MONO }}>{fileUrl}</span></div>
              <div style={{ marginTop: 6 }}>Contents (exactly):</div>
              <code style={{ fontFamily: MONO, fontSize: 13 }}>{token}</code>
            </div>
          </div>
        )}

        <button className="gv-onb-btn" onClick={check} disabled={polling} style={{ marginTop: 32 }}>
          {polling ? 'Checking all methods…' : 'I added it — verify now'}
        </button>
        {msg && <p style={{ marginTop: 14, color: DIM, fontSize: 14 }}>{msg}</p>}

        <p style={{ marginTop: 26, fontSize: 14, color: DIM, lineHeight: 1.6 }}>
          Don&apos;t have DNS access right now?{' '}
          <a href="/dashboard" style={{ color: 'var(--gv-accent-ink)', textDecoration: 'underline' }}>Skip for now →</a>{' '}
          You can already queue topics and watch Grove write — autopilot publishing stays paused until you verify.
        </p>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><VerifyInner /></Suspense>;
}
