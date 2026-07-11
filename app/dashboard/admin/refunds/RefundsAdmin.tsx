'use client';
import { useState } from 'react';
import { reasonLabel } from '@/lib/refunds';

const ACCENT = 'var(--gv-accent)';
const LINE = 'rgba(255,255,255,0.08)';

export type RefundRow = {
  id: string;
  email: string | null;
  plan: string | null;
  reason: string | null;
  feedback: string | null;
  comeback: string | null;
  status: string;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
  processed_at: string | null;
  processed_by: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: 'rgba(217,156,43,0.16)', fg: 'var(--gv-amber)' },
  refunded: { bg: 'rgba(99,194,129,0.16)', fg: ACCENT },
  no_charge: { bg: 'rgba(255,255,255,0.06)', fg: 'var(--gv-dim)' },
  failed: { bg: 'rgba(255,99,99,0.14)', fg: 'var(--gv-red-text)' },
  dismissed: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--gv-faint)' },
};

export default function RefundsAdmin({ initialRows }: { initialRows: RefundRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(id: string, action: 'refund' | 'dismiss') {
    if (action === 'refund' && !confirm('Issue a full Stripe refund and cancel this subscription? This cannot be undone.')) return;
    setErr(null);
    setBusy(id + action);
    const res = await fetch(`/api/billing/refund-request/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.error ?? 'Action failed.');
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: j.status ?? r.status, processed_at: new Date().toISOString() } : r)));
  }

  if (rows.length === 0) {
    return <p style={{ color: 'var(--gv-dim)', fontSize: 14 }}>No refund requests yet.</p>;
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      {err && <p style={{ color: 'var(--gv-red-text)', fontSize: 13.5, marginBottom: 14 }}>{err}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => {
          const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.dismissed;
          const amount = r.amount_cents != null && r.currency
            ? `${(r.amount_cents / 100).toFixed(2)} ${r.currency.toUpperCase()}`
            : null;
          const pending = r.status === 'pending';
          return (
            <div key={r.id} style={{ background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--gv-ink)' }}>{r.email ?? 'unknown'}</span>
                <span style={{ fontSize: 12, color: 'var(--gv-dim)' }}>{r.plan ? r.plan.charAt(0).toUpperCase() + r.plan.slice(1) : '—'}</span>
                {amount && <span style={{ fontSize: 12, color: 'var(--gv-dim)' }}>· {amount}</span>}
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: s.bg, color: s.fg }}>{r.status}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)' }}>{new Date(r.created_at).toLocaleString('en-US')}</span>
              </div>

              <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--gv-soft)', lineHeight: 1.6 }}>
                <div><span style={{ color: 'var(--gv-dim)' }}>Reason:</span> {reasonLabel(r.reason)}</div>
                {r.feedback && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--gv-dim)' }}>Better:</span> {r.feedback}</div>}
                {r.comeback && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--gv-dim)' }}>Comeback:</span> {r.comeback}</div>}
              </div>

              {pending ? (
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button onClick={() => act(r.id, 'refund')} disabled={busy !== null}
                    style={{ background: ACCENT, color: 'var(--gv-on-accent)', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === r.id + 'refund' ? 'Issuing…' : 'Issue full refund + cancel'}
                  </button>
                  <button onClick={() => act(r.id, 'dismiss')} disabled={busy !== null}
                    style={{ background: 'transparent', color: 'var(--gv-dim)', border: `1px solid ${LINE}`, borderRadius: 9, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === r.id + 'dismiss' ? '…' : 'Dismiss'}
                  </button>
                </div>
              ) : r.processed_at ? (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gv-faint)' }}>
                  {r.status} {r.processed_by ? `by ${r.processed_by}` : ''} · {new Date(r.processed_at).toLocaleString('en-US')}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
