'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCode, betaWindowLabel, type BetaState } from '@/lib/beta';
import { useT } from '../i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';

/**
 * The beta surface on the billing page. One component, three states, because
 * they are the same question — "what is this account's free access?" — and
 * splitting them across pages would mean a customer whose beta lapsed has
 * nowhere obvious to find out why generation stopped.
 *
 *   live     → how long is left, what it includes, and the ask (feedback)
 *   expired  → what happened, what they keep, and the upgrade
 *   none     → a quiet redeem box
 */
export default function BetaPanel({
  beta,
  hasPaidPlan,
}: {
  beta: BetaState;
  hasPaidPlan: boolean;
}) {
  const t = useT();
  if (beta.present) return <BetaStatus beta={beta} />;
  // Someone already paying doesn't need a redeem box; Stripe promotion codes at
  // checkout are the discount path for them, and offering both invites the
  // "I entered my code and nothing happened" support ticket.
  if (hasPaidPlan) return null;
  return <RedeemBox />;
}

/* ─────────────────────────── live / expired grant ───────────────────────── */

function BetaStatus({ beta }: { beta: BetaState }) {
  const t = useT();
  const live = beta.active;
  const ends = beta.expiresAt
    ? new Date(beta.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : null;

  return (
    <div
      style={{
        background: live ? 'rgba(162,255,1,0.07)' : 'var(--gv-card)',
        border: `1px solid ${live ? 'rgba(162,255,1,0.22)' : LINE}`,
        borderRadius: 14,
        padding: '18px 20px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '3px 9px', borderRadius: 999,
            background: live ? ACCENT : 'rgba(255,255,255,0.08)',
            color: live ? 'var(--gv-on-accent)' : 'var(--gv-faint)',
          }}
        >
          {t('Beta')}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--gv-ink)' }}>
          {betaWindowLabel(beta)}
        </span>
        {beta.code && (
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--gv-faint)' }}>
            {formatCode(beta.code)}
          </span>
        )}
      </div>

      {live ? (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', lineHeight: 1.6, margin: '10px 0 0' }}>
            You have {beta.postsQuota} posts a month, free{ends ? `, through ${ends}` : ''}. No card, nothing
            to cancel — when it ends, everything you&apos;ve published stays exactly where it is.
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', lineHeight: 1.6, margin: '10px 0 0' }}>
            All we want in return is the truth about it.{' '}
            <Link href="/dashboard/feedback" style={{ color: ACCENT_INK, fontWeight: 600 }}>
              {t('Tell us what worked and what didn\'t →')}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', lineHeight: 1.6, margin: '10px 0 0' }}>
            Your free beta has ended, so Grove has stopped writing new posts. Everything it already published is
            still live on your site and stays yours — pick a plan below to start the pipeline again.
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--gv-dim)', lineHeight: 1.6, margin: '10px 0 0' }}>
            Not continuing?{' '}
            <Link href="/dashboard/feedback" style={{ color: ACCENT_INK, fontWeight: 600 }}>
              {t('Tell us why')}
            </Link>{' '}
            — that&apos;s the most useful thing you can leave us.
          </p>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────── redeem a code ───────────────────────────── */

function RedeemBox() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setErr(null);
    setBusy(true);
    const res = await fetch('/api/beta/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // The server decides the wording (lib/beta COUPON_PROBLEM_MESSAGE) so the
      // customer reads the same sentence the server reasoned about.
      return setErr(j.message ?? t('That code could not be redeemed.'));
    }
    // Server-rendered page: refresh rather than patching state, so the quota
    // meter, the entitlement banner and the nav all pick the grant up at once.
    router.refresh();
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13.5, color: 'var(--gv-dim)',
          }}
        >
          {t('Have a beta code?')} <span style={{ color: ACCENT_INK, fontWeight: 600 }}>{t('Redeem it →')}</span>
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14,
        padding: '16px 18px', marginBottom: 16,
      }}
    >
      <label htmlFor="beta-code" style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--gv-ink)', marginBottom: 8 }}>
        {t('Redeem a beta code')}
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          id="beta-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="GROVEBETA"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          style={{
            flex: '1 1 200px', minWidth: 0, padding: '10px 13px', borderRadius: 10,
            border: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.03)',
            color: 'var(--gv-ink)', fontFamily: 'var(--font-mono, monospace)',
            fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          style={{
            padding: '10px 18px', borderRadius: 10, border: 'none', cursor: busy ? 'default' : 'pointer',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
            background: busy || !code.trim() ? 'rgba(255,255,255,0.08)' : ACCENT,
            color: busy || !code.trim() ? 'var(--gv-faint)' : 'var(--gv-on-accent)',
          }}
        >
          {busy ? t('Checking…') : t('Redeem')}
        </button>
      </div>
      {err && <p style={{ fontSize: 13, color: 'var(--gv-red-text)', margin: '10px 0 0', lineHeight: 1.55 }}>{err}</p>}
      <p style={{ fontSize: 12.5, color: 'var(--gv-faint)', margin: '10px 0 0', lineHeight: 1.55 }}>
        {t('Beta codes give you a free run of Grove — no card, nothing to cancel.')}
      </p>
    </form>
  );
}
