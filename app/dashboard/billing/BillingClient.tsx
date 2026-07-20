'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { BillingInterval, Plan, PlanId } from '@/lib/plans';
import { ANNUAL_DISCOUNT, formatUsd, monthlyPriceUsd, yearlyPriceUsd } from '@/lib/plans';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export default function BillingClient({
  plans,
  currentPlan,
  currentInterval,
  status,
  hasCustomer,
  currentPeriodEnd,
}: {
  plans: Plan[];
  currentPlan: PlanId | null;
  currentInterval: BillingInterval | null;
  status: string | null;
  hasCustomer: boolean;
  currentPeriodEnd: string | null;
}) {
  const sp = useSearchParams();
  const flash = sp.get('status'); // success | cancel
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Default to what they're already on, so their own plan reads as CURRENT.
  const [interval, setInterval] = useState<BillingInterval>(currentInterval ?? 'month');

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
    const url = await post('/api/billing/checkout', { plan, interval });
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
    ? new Date(currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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
          <div style={{ fontSize: 13, color: 'var(--gv-dim)' }}>Current plan</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gv-ink)', letterSpacing: '-0.01em' }}>
            {currentPlan ? plans.find((p) => p.id === currentPlan)?.name : 'No active plan'}
            {status && currentPlan && (
              <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 10, padding: '3px 9px', borderRadius: 999, background: 'rgba(162,255,1,0.14)', color: ACCENT_INK, verticalAlign: 'middle' }}>
                {status}
              </span>
            )}
          </div>
          {renews && currentPlan && (
            <div style={{ fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 4 }}>Renews {renews}</div>
          )}
        </div>
        {hasCustomer && (
          <button onClick={manage} disabled={busy !== null} className="gv-ghost"
            style={{ marginLeft: 'auto', border: '1px solid rgba(15,23,18,0.12)', background: 'rgba(15,23,18,0.02)', color: 'var(--gv-soft)', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {busy === 'manage' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {/* interval toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
        <div style={{ display: 'inline-flex', padding: 4, background: 'rgba(15,23,18,0.03)', border: '1px solid rgba(15,23,18,0.1)', borderRadius: 999, gap: 4 }}>
          {(['month', 'year'] as const).map((iv) => {
            const on = interval === iv;
            return (
              <button key={iv} onClick={() => setInterval(iv)}
                style={{ border: 'none', cursor: 'pointer', padding: '8px 18px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit',
                  background: on ? 'var(--gv-ink)' : 'transparent', color: on ? 'var(--gv-card)' : 'var(--gv-dim)' }}>
                {iv === 'month' ? 'Monthly' : 'Annual'}
                {iv === 'year' && (
                  <span style={{ fontSize: 11, marginLeft: 6, color: on ? 'var(--gv-card)' : ACCENT_INK, opacity: on ? 0.75 : 1 }}>
                    −{Math.round(ANNUAL_DISCOUNT * 100)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* plan cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }} className="gv-grid3">
        {plans.map((p) => {
          // Only the plan they actually bought, on the interval they bought it.
          const isCurrent = p.id === currentPlan && interval === (currentInterval ?? interval);
          return (
            <div key={p.id} className="gv-card"
              style={{ background: 'var(--gv-card)', border: `1px solid ${isCurrent ? 'rgba(162,255,1,0.45)' : 'rgba(15,23,18,0.08)'}`, borderRadius: 16, padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--gv-ink)' }}>{p.name}</span>
                  {isCurrent && <span style={{ fontSize: 10.5, fontWeight: 700, color: ACCENT_INK }}>CURRENT</span>}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--gv-ink)' }}>${monthlyPriceUsd(p.id, interval)}</span>
                  <span style={{ fontSize: 13, color: 'var(--gv-dim)' }}>/mo</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginTop: 3 }}>
                  {interval === 'year' ? `$${formatUsd(yearlyPriceUsd(p.id))} billed yearly` : 'billed monthly'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--gv-dim)', marginTop: 6 }}>{p.blurb}</div>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ fontSize: 13.5, color: 'var(--gv-soft)', display: 'flex', gap: 9 }}>
                    <span style={{ color: ACCENT_INK }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button onClick={() => choose(p.id)} disabled={busy !== null || isCurrent}
                style={{ marginTop: 'auto', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer', fontFamily: 'inherit', border: 'none',
                  background: isCurrent ? 'rgba(15,23,18,0.05)' : ACCENT, color: isCurrent ? 'var(--gv-faint)' : 'var(--gv-on-accent)', opacity: busy && busy !== p.id ? 0.6 : 1 }}>
                {isCurrent ? 'Current plan' : busy === p.id ? 'Redirecting…' : currentPlan ? 'Switch to this' : 'Choose plan'}
              </button>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 22, lineHeight: 1.6 }}>
        Secure checkout by Stripe. Cancel anytime from <strong style={{ color: 'var(--gv-dim)' }}>Manage billing</strong>.
        Full refunds available on request —{' '}
        <Link href="/dashboard/billing/cancel" style={{ color: 'var(--gv-dim)', textDecoration: 'underline' }}>
          cancel &amp; request a refund
        </Link>.
      </p>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'ok' | 'err' | 'muted'; children: React.ReactNode }) {
  const styles = {
    ok: { bg: 'rgba(162,255,1,0.1)', bd: 'rgba(162,255,1,0.3)', fg: 'var(--mint)' },
    err: { bg: 'rgba(255,99,99,0.1)', bd: 'rgba(255,99,99,0.3)', fg: 'var(--gv-red-text)' },
    muted: { bg: 'rgba(15,23,18,0.04)', bd: 'rgba(15,23,18,0.1)', fg: 'var(--gv-soft)' },
  }[tone];
  return (
    <div style={{ background: styles.bg, border: `1px solid ${styles.bd}`, color: styles.fg, borderRadius: 12, padding: '12px 16px', fontSize: 13.5, marginBottom: 18 }}>
      {children}
    </div>
  );
}
