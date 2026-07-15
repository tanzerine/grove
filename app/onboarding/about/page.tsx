'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import GroveMark from '@/components/GroveMark';

const DIM = 'var(--gv-dim)';

const REFERRAL_OPTIONS = [
  'Google / search',
  'X (Twitter)',
  'LinkedIn',
  'Reddit / community',
  'Friend or colleague',
  'Newsletter / blog',
  'YouTube / podcast',
  'Other',
];

const SECTORS = [
  'SaaS / Software',
  'E-commerce / Retail',
  'Agency / Marketing services',
  'Media / Content / Creator',
  'Finance / Fintech',
  'Health / Wellness',
  'Education',
  'Real estate / Property',
  'Travel / Hospitality',
  'Professional services',
  'Other',
];

const SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];

function AboutInner() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const sp = useSearchParams();

  const domainParam = sp.get('domain') ?? '';
  const nextStep = `/onboarding/domain${domainParam ? `?domain=${encodeURIComponent(domainParam)}` : ''}`;

  const [ready, setReady] = useState(false);
  const [referral, setReferral] = useState('');
  const [orgName, setOrgName] = useState('');
  const [sector, setSector] = useState('');
  const [size, setSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Returning users who already answered this shouldn't see it again — forward
  // straight to the domain step. Otherwise prefill anything on file.
  useEffect(() => {
    let alive = true;
    sb.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const meta = data.user?.user_metadata ?? {};
      if (meta.onboarded_about) {
        router.replace(nextStep);
        return;
      }
      setReferral((meta.referral_source as string) ?? '');
      setOrgName((meta.org_name as string) ?? '');
      setSector((meta.sector as string) ?? '');
      setSize((meta.company_size as string) ?? '');
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [sb, router, nextStep]);

  async function submit() {
    setBusy(true);
    setErr(null);
    const { error } = await sb.auth.updateUser({
      data: {
        referral_source: referral || null,
        org_name: orgName.trim() || null,
        sector: sector || null,
        company_size: size || null,
        onboarded_about: true,
      },
    });
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }
    router.replace(nextStep);
  }

  if (!ready) {
    return (
      <main className="gv-onb">
        <GroveMark />
        <div className="gv-onb-in" style={{ maxWidth: 560 }}>
          <p className="gv-onb-lede">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="gv-onb">
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden>
        <span className="b1" />
        <span className="b2" />
      </div>
      <div className="gv-onb-in" style={{ maxWidth: 560 }}>
        <span className="gv-onb-eyebrow">Welcome — a couple of quick things</span>
        <h1 className="gv-onb-title" style={{ fontSize: 'clamp(28px, 7vw, 40px)' }}>Tell us about you</h1>
        <p className="gv-onb-lede">
          This tailors your strategy and helps us understand who Grove is writing for. Takes ten seconds.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 26 }}>
          <Field label="How did you find us?">
            <select className="gv-onb-input" value={referral} onChange={(e) => setReferral(e.target.value)}>
              <option value="">Select one…</option>
              {REFERRAL_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>

          <Field label="Organization name">
            <input
              className="gv-onb-input"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Inc."
            />
          </Field>

          <Field label="What sector are you in?">
            <select className="gv-onb-input" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Select one…</option>
              {SECTORS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>

          <Field label="How big is your team?">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SIZES.map((o) => {
                const selected = size === o;
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setSize(o)}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: `1px solid ${selected ? 'rgba(99,194,129,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      background: selected ? 'rgba(99,194,129,0.12)' : 'rgba(255,255,255,0.02)',
                      color: selected ? 'var(--gv-ink)' : 'var(--gv-soft)',
                      fontFamily: 'inherit',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        {err && <p style={{ color: 'var(--gv-red-text)', fontSize: 13, marginTop: 16 }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
          <button onClick={submit} disabled={busy} className="gv-onb-btn">
            {busy ? 'Saving…' : 'Continue →'}
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gv-ink)' }}>{label}</span>
      {children}
    </label>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AboutInner />
    </Suspense>
  );
}
