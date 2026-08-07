'use client';
import { useState } from 'react';
import { formatCode, COUPON_PROBLEM_MESSAGE } from '@/lib/beta';
import type { CouponWithState } from '@/lib/beta-store';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';
const DIM = 'var(--gv-dim)';

/**
 * Mint and manage the codes that give away free access.
 *
 * The one thing this screen must never do is make it easy to promise more than
 * Grove can produce, so the capacity arithmetic the API returns is shown as a
 * warning on the new code rather than buried in a doc nobody reads.
 */
export default function BetaAdmin({ initialCoupons }: { initialCoupons: CouponWithState[] }) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [open, setOpen] = useState(initialCoupons.length === 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  // Form state. Defaults describe the campaign we expect to run most often: a
  // month of Starter-equivalent volume, capped so it can't run away.
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [postsQuota, setPostsQuota] = useState(12);
  const [days, setDays] = useState(30);
  const [maxRedemptions, setMaxRedemptions] = useState<number | ''>(25);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setWarning(null);
    setBusy('create');
    const res = await fetch('/api/admin/beta-coupons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: code.trim() || undefined,
        label: label.trim() || undefined,
        posts_quota: postsQuota,
        days,
        max_redemptions: maxRedemptions === '' ? null : maxRedemptions,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'Could not create the code.');

    setCoupons((cs) => [
      { ...j.coupon, problem: null, remaining: j.coupon.max_redemptions },
      ...cs,
    ]);
    setJustCreated(j.coupon.code);
    setWarning(j.warning ?? null);
    setCode('');
    setLabel('');
  }

  async function toggle(id: string, active: boolean) {
    setErr(null);
    setBusy(id);
    const res = await fetch(`/api/admin/beta-coupons/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'Update failed.');
    setCoupons((cs) =>
      cs.map((c) => (c.id === id ? { ...c, active, problem: active ? c.problem : 'inactive' } : c)),
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      {err && <p style={{ color: 'var(--gv-red-text)', fontSize: 13.5, marginBottom: 14 }}>{err}</p>}

      {justCreated && (
        <div style={{ background: 'rgba(162,255,1,0.08)', border: '1px solid rgba(162,255,1,0.22)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: DIM }}>New code — hand this out:</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.1em', color: ACCENT_INK, margin: '5px 0 0', fontFamily: 'var(--font-mono, monospace)' }}>
            {formatCode(justCreated)}
          </div>
        </div>
      )}

      {warning && (
        <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: '12px 15px', marginBottom: 14, fontSize: 13, color: 'var(--gv-amber)', lineHeight: 1.55 }}>
          {warning}
        </div>
      )}

      {open ? (
        <form onSubmit={create} style={{ background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--gv-ink)', marginBottom: 14 }}>New beta code</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Field label="Code" hint="blank = generated">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="LAUNCH25"
                maxLength={64} autoComplete="off" spellCheck={false}
                style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '0.06em' }} />
            </Field>
            <Field label="Campaign" hint="for you only">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Product Hunt launch"
                maxLength={120} style={inputStyle} />
            </Field>
            <Field label="Posts / month">
              <input type="number" min={1} max={500} value={postsQuota}
                onChange={(e) => setPostsQuota(Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label="Days of access">
              <input type="number" min={1} max={365} value={days}
                onChange={(e) => setDays(Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label="Max redemptions" hint="blank = unlimited">
              <input type="number" min={1} value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value === '' ? '' : Number(e.target.value))}
                style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
            <button type="submit" disabled={busy === 'create'}
              style={{
                padding: '10px 18px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                background: busy === 'create' ? 'rgba(255,255,255,0.08)' : ACCENT,
                color: busy === 'create' ? 'var(--gv-faint)' : 'var(--gv-on-accent)',
              }}>
              {busy === 'create' ? 'Creating…' : 'Create code'}
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--gv-faint)' }}>
              Fully redeemed, this promises{' '}
              {maxRedemptions === '' ? 'unlimited' : (maxRedemptions * postsQuota).toLocaleString()} posts/month.
            </span>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          style={{
            marginBottom: 18, padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
            background: ACCENT, border: 'none', color: 'var(--gv-on-accent)',
          }}>
          + New beta code
        </button>
      )}

      {coupons.length === 0 ? (
        <p style={{ color: DIM, fontSize: 14 }}>No beta codes yet — create one above to start the beta.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {coupons.map((c) => {
            const live = !c.problem;
            return (
              <div key={c.id} style={{ background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--gv-ink)', fontFamily: 'var(--font-mono, monospace)' }}>
                    {formatCode(c.code)}
                  </span>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                    padding: '3px 8px', borderRadius: 999,
                    background: live ? 'rgba(162,255,1,0.14)' : 'rgba(255,255,255,0.06)',
                    color: live ? ACCENT_INK : 'var(--gv-faint)',
                  }}>
                    {live ? 'Live' : c.problem}
                  </span>
                  {c.label && <span style={{ fontSize: 13, color: DIM }}>{c.label}</span>}
                  <button type="button" onClick={() => toggle(c.id, !c.active)} disabled={busy === c.id}
                    style={{
                      marginLeft: 'auto', background: 'transparent', border: `1px solid ${LINE}`,
                      borderRadius: 9, padding: '6px 12px', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                      color: c.active ? 'var(--gv-red-text)' : ACCENT_INK,
                    }}>
                    {busy === c.id ? '…' : c.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5, color: 'var(--gv-faint)' }}>
                  <span>{c.posts_quota} posts/mo · {c.days} days</span>
                  <span>
                    {c.redeemed_count} redeemed
                    {c.max_redemptions !== null && ` of ${c.max_redemptions}`}
                    {c.remaining !== null && c.remaining > 0 && ` · ${c.remaining} left`}
                  </span>
                  {c.expires_at && (
                    <span>expires {new Date(c.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  )}
                </div>

                {/* The exact sentence a customer would see if they tried it now.
                    Guessing why a code "doesn't work" is the support ticket this
                    line exists to prevent. */}
                {c.problem && (
                  <p style={{ fontSize: 12.5, color: 'var(--gv-faint)', margin: '9px 0 0', fontStyle: 'italic' }}>
                    Customers see: “{COUPON_PROBLEM_MESSAGE[c.problem]}”
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--gv-ink)', marginBottom: 6 }}>
        {label} {hint && <span style={{ fontWeight: 400, color: 'var(--gv-fainter)' }}>· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${LINE}`,
  background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)', fontFamily: 'inherit', fontSize: 13.5,
};
