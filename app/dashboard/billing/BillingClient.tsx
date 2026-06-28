'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Plan, PlanId } from '@/lib/plans';

const ACCENT = '#63c281';

export default function BillingClient({
  plans,
  currentPlan,
  status,
  hasCustomer,
  currentPeriodEnd,
}: {
  plans: Plan[];
  currentPlan: PlanId | null;
  status: string | null;
  hasCustomer: boolean;
  currentPeriodEnd: string | null;
}) {
  const sp = useSearchParams();
  const flash = sp.get('status'); // success | cancel
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(url: string, body?: unknown): Promise<string | null> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.error ?? 'Something went wrong.');
      return null;
    }
    return j.url ?? null;
  }

  async function choose(plan: PlanId) {
    setErr(null);
    setBusy(plan);
    const url = await post('/api/billing/checkout', { plan });
    if (url) window.location.href = url;
    else setBusy(null);
  }

  async function manage() {
    setErr(null);
    setBusy('manage');
    const url = await post('/api/billing/portal');
    if (url) window.location.href = url;
    else setBusy(null);
  }

  const renews = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      {flash === 'success' && (
        <Banner tone="ok">Payment received — your plan is being activated. It updates here within a few seconds.</Banner>
      )}
      {flash === 'cancel' && (
        <Banner tone="muted">Checkout canceled — no charge was made.</Banner>
      )}
      {err && <Banner tone="err">{err}</Banner>}

      {/* current status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '6px 0 26px' }}>
        <div>
          <div style={{ fontSize: 13, color: '#9aa096' }}>Current plan</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#eef1ea', letterSpacing: '-0.01em' }}>
            {currentPlan ? plans.find((p) => p.id === currentPlan)?.name : 'No active plan'}
            {status && currentPlan && (
              <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 10, padding: '3px 9px', borderRadius: 999, background: 'rgba(99,194,129,0.14)', color: ACCENT, verticalAlign: 'middle' }}>
                {status}
              </span>
            )}
          </div>
          {renews && currentPlan && (
            <div style={{ fontSize: 12.5, color: '#6b6f67', marginTop: 4 }}>Renews {renews}</div>
          )}
        </div>
        {hasCustomer && (
          <button onClick={manage} disabled={busy !== null} className="gv-ghost"
            style={{ marginLeft: 'auto', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {busy === 'manage' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {/* plan cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }} className="gv-grid3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlan;
          return (
            <div key={p.id} className="gv-card"
              style={{ background: '#101310', border: `1px solid ${isCurrent ? 'rgba(99,194,129,0.45)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 16, padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: '#eef1ea' }}>{p.name}</span>
                  {isCurrent && <span style={{ fontSize: 10.5, fontWeight: 700, color: ACCENT }}>CURRENT</span>}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: '#eef1ea' }}>${p.priceUsd}</span>
                  <span style={{ fontSize: 13, color: '#9aa096' }}>/mo</span>
                </div>
                <div style={{ fontSize: 13, color: '#9aa096', marginTop: 6 }}>{p.blurb}</div>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ fontSize: 13.5, color: '#cdd2c9', display: 'flex', gap: 9 }}>
                    <span style={{ color: ACCENT }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button onClick={() => choose(p.id)} disabled={busy !== null || isCurrent}
                style={{ marginTop: 'auto', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer', fontFamily: 'inherit', border: 'none',
                  background: isCurrent ? 'rgba(255,255,255,0.05)' : ACCENT, color: isCurrent ? '#6b6f67' : '#06120b', opacity: busy && busy !== p.id ? 0.6 : 1 }}>
                {isCurrent ? 'Current plan' : busy === p.id ? 'Redirecting…' : currentPlan ? 'Switch to this' : 'Choose plan'}
              </button>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12.5, color: '#6b6f67', marginTop: 22, lineHeight: 1.6 }}>
        Secure checkout by Stripe. Cancel anytime from <strong style={{ color: '#9aa096' }}>Manage billing</strong>.
        Full refunds available on request —{' '}
        <Link href="/dashboard/billing/cancel" style={{ color: '#9aa096', textDecoration: 'underline' }}>
          cancel &amp; request a refund
        </Link>.
      </p>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'ok' | 'err' | 'muted'; children: React.ReactNode }) {
  const styles = {
    ok: { bg: 'rgba(99,194,129,0.1)', bd: 'rgba(99,194,129,0.3)', fg: '#9ff0bb' },
    err: { bg: 'rgba(255,99,99,0.1)', bd: 'rgba(255,99,99,0.3)', fg: '#ff9b9b' },
    muted: { bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.1)', fg: '#cdd2c9' },
  }[tone];
  return (
    <div style={{ background: styles.bg, border: `1px solid ${styles.bd}`, color: styles.fg, borderRadius: 12, padding: '12px 16px', fontSize: 13.5, marginBottom: 18 }}>
      {children}
    </div>
  );
}
