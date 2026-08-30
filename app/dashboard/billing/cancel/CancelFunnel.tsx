'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { RefundReason } from '@/lib/refunds';
import { captureClient } from '@/lib/analytics/capture-client';
import { useT } from '../../i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const CARD = 'var(--gv-card)';
const LINE = 'rgba(255,255,255,0.08)';

// Three-step exit funnel: (1) why are you leaving, (2) free-text insight,
// (3) confirm → submit. Submitting records the request + emails the owner;
// the actual refund is approved by the owner (no money moves here).
export default function CancelFunnel({ reasons, plan }: { reasons: RefundReason[]; plan: string | null }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [comeback, setComeback] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setErr(null);
    setBusy(true);
    const res = await fetch('/api/billing/refund-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason, feedback: feedback || undefined, comeback: comeback || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? t('Something went wrong. Please try again.'));
    }
    captureClient('refund_requested', { reason, plan: plan ?? undefined });
    setDone(true);
  }

  if (done) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '24px 8px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(162,255,1,0.14)', color: ACCENT_INK, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>✓</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gv-ink)', margin: '0 0 8px' }}>{t('Request received')}</h2>
          <p style={{ fontSize: 14.5, color: 'var(--gv-dim)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto 20px' }}>
            Thanks for the feedback — it genuinely helps. We&apos;ll review your refund and email you once it&apos;s
            processed. Refunds return to your card within a few business days.
          </p>
          <Link href="/dashboard/billing" style={{ color: ACCENT_INK, fontWeight: 600, fontSize: 14 }}>← Back to billing</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* progress */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
        {[1, 2, 3].map((n) => (
          <div key={n} style={{ flex: 1, height: 4, borderRadius: 99, background: n <= step ? ACCENT : 'rgba(255,255,255,0.08)' }} />
        ))}
      </div>

      {step === 1 && (
        <>
          <h2 style={Title}>{t('Before you go — what\'s the main reason?')}</h2>
          <p style={Sub}>{plan ? `You're on the ${cap(plan)} plan. ` : ''}Your honest answer shapes what we build next.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {reasons.map((r) => (
              <button key={r.code} type="button" onClick={() => setReason(r.code)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer',
                  padding: '13px 15px', borderRadius: 11, fontFamily: 'inherit', fontSize: 14.5,
                  background: reason === r.code ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${reason === r.code ? 'rgba(162,255,1,0.5)' : LINE}`,
                  color: reason === r.code ? 'var(--gv-ink)' : 'var(--gv-soft)',
                }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${reason === r.code ? ACCENT : 'var(--gv-fainter)'}`, background: reason === r.code ? ACCENT : 'transparent' }} />
                {r.label}
              </button>
            ))}
          </div>
          <Nav>
            <Link href="/dashboard/billing" style={GhostLink}>{t('Never mind, keep my plan')}</Link>
            <button onClick={() => setStep(2)} disabled={!reason} style={primaryBtn(!reason)}>{t('Continue →')}</button>
          </Nav>
        </>
      )}

      {step === 2 && (
        <>
          <h2 style={Title}>{t('What could we have done better?')}</h2>
          <p style={Sub}>{t('Optional, but the most useful thing you can leave us.')}</p>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4}
            placeholder="The one thing that would've made Grove worth keeping…" style={textArea} maxLength={2000} />
          <label style={{ display: 'block', fontSize: 13.5, color: 'var(--gv-dim)', margin: '18px 0 7px' }}>
            {t('What would bring you back?')}
          </label>
          <textarea value={comeback} onChange={(e) => setComeback(e.target.value)} rows={3}
            placeholder={t('A feature, a price, a result…')} style={textArea} maxLength={2000} />
          <Nav>
            <button onClick={() => setStep(1)} style={GhostBtn}>← Back</button>
            <button onClick={() => setStep(3)} style={primaryBtn(false)}>{t('Continue →')}</button>
          </Nav>
        </>
      )}

      {step === 3 && (
        <>
          <h2 style={Title}>{t('Confirm your refund request')}</h2>
          <p style={Sub}>
            We&apos;ll cancel your subscription and process a full refund after a quick review. You&apos;ll get a
            confirmation email. Refunds land back on your card within a few business days.
          </p>
          <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16, fontSize: 13.5, color: 'var(--gv-soft)' }}>
            <Row k="Plan" v={plan ? cap(plan) : '—'} />
            <Row k="Reason" v={reasons.find((r) => r.code === reason)?.label ?? '—'} />
          </div>
          {err && <p style={{ color: 'var(--gv-red-text)', fontSize: 13.5, marginTop: 14 }}>{err}</p>}
          <Nav>
            <button onClick={() => setStep(2)} disabled={busy} style={GhostBtn}>← Back</button>
            <button onClick={submit} disabled={busy} style={primaryBtn(busy)}>
              {busy ? t('Submitting…') : t('Request refund')}
            </button>
          </Nav>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: '28px 26px' }}>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
      <span style={{ color: 'var(--gv-dim)' }}>{k}</span><span style={{ color: 'var(--gv-ink)' }}>{v}</span>
    </div>
  );
}
function Nav({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 24 }}>{children}</div>;
}

const Title: React.CSSProperties = { fontSize: 21, fontWeight: 700, color: 'var(--gv-ink)', margin: 0, letterSpacing: '-0.01em' };
const Sub: React.CSSProperties = { fontSize: 14, color: 'var(--gv-dim)', margin: '8px 0 0', lineHeight: 1.55 };
const textArea: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`, borderRadius: 11, color: 'var(--gv-ink)', fontSize: 14.5, fontFamily: 'inherit', padding: '12px 14px', outline: 'none', resize: 'vertical' };
const GhostLink: React.CSSProperties = { fontSize: 13.5, color: 'var(--gv-dim)' };
const GhostBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: 'var(--gv-dim)', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
function primaryBtn(disabled: boolean): React.CSSProperties {
  return { background: ACCENT, color: 'var(--gv-on-accent)', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', opacity: disabled ? 0.5 : 1 };
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
