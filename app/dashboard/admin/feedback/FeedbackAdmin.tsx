'use client';
import { useMemo, useState } from 'react';
import {
  FEEDBACK_STATUSES,
  areaLabel,
  kindLabel,
  severityLabel,
  isOpen,
  FEEDBACK_LIMITS,
  type FeedbackStatus,
} from '@/lib/feedback';
import type { FeedbackRow } from '@/lib/feedback-store';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';
const DIM = 'var(--gv-dim)';

const KIND_STYLE: Record<string, { bg: string; fg: string }> = {
  testimonial: { bg: 'rgba(162,255,1,0.14)', fg: ACCENT_INK },
  shortcoming: { bg: 'rgba(255,255,255,0.1)', fg: 'var(--gv-amber)' },
  complaint: { bg: 'rgba(255,99,99,0.14)', fg: 'var(--gv-red-text)' },
};

type Filter = 'open' | 'all' | 'complaint' | 'shortcoming' | 'testimonial';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Needs you' },
  { id: 'complaint', label: 'Complaints' },
  { id: 'shortcoming', label: 'Shortcomings' },
  { id: 'testimonial', label: 'Testimonials' },
  { id: 'all', label: 'Everything' },
];

/**
 * The owner's feedback inbox.
 *
 * Rows arrive pre-sorted by triage rank from the server (lib/feedback-store),
 * so the order here is deliberately left alone — filtering never re-sorts, and
 * the blocking complaint stays at the top of whichever view you're in.
 */
export default function FeedbackAdmin({ initialRows }: { initialRows: FeedbackRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter((r) => isOpen(r.status));
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  const counts = useMemo(() => ({
    open: rows.filter((r) => isOpen(r.status)).length,
    complaint: rows.filter((r) => r.kind === 'complaint').length,
    shortcoming: rows.filter((r) => r.kind === 'shortcoming').length,
    testimonial: rows.filter((r) => r.kind === 'testimonial').length,
    all: rows.length,
  }), [rows]);

  async function patch(id: string, body: Record<string, unknown>, tag: string) {
    setErr(null);
    setBusy(id + tag);
    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'Update failed.');
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, ...body, responded_at: new Date().toISOString() } as FeedbackRow : r)),
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = filter === f.id;
          const n = counts[f.id];
          return (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              style={{
                padding: '7px 13px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                background: on ? ACCENT : 'rgba(255,255,255,0.03)',
                border: `1px solid ${on ? ACCENT : LINE}`,
                color: on ? 'var(--gv-on-accent)' : DIM,
              }}>
              {f.label}{n ? ` · ${n}` : ''}
            </button>
          );
        })}
      </div>

      {err && <p style={{ color: 'var(--gv-red-text)', fontSize: 13.5, marginBottom: 14 }}>{err}</p>}

      {shown.length === 0 ? (
        <p style={{ color: DIM, fontSize: 14 }}>
          {filter === 'open' ? 'Nothing waiting on you. ' : 'Nothing here yet. '}
          {rows.length === 0 && 'Feedback from customers will land here as soon as it arrives.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((r) => (
            <Card key={r.id} row={r} busy={busy} onPatch={patch} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({
  row: r,
  busy,
  onPatch,
}: {
  row: FeedbackRow;
  busy: string | null;
  onPatch: (id: string, body: Record<string, unknown>, tag: string) => void;
}) {
  const [note, setNote] = useState(r.owner_note ?? '');
  const [noteOpen, setNoteOpen] = useState(false);
  const k = KIND_STYLE[r.kind] ?? KIND_STYLE.shortcoming;
  const blocker = r.kind === 'complaint' && r.severity === 'blocker';

  // Publishing is offered only where it is legal to offer it: a testimonial
  // whose author ticked the consent box. Without consent the button is replaced
  // by the reason, so the owner isn't left wondering where it went.
  const canPublish = r.kind === 'testimonial' && r.consent_publish;

  return (
    <div style={{
      background: 'var(--gv-card)',
      border: `1px solid ${blocker ? 'rgba(255,99,99,0.35)' : LINE}`,
      borderRadius: 14, padding: '16px 18px',
    }}>
      {/* who + what */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Badge bg={k.bg} fg={k.fg}>{kindLabel(r.kind)}</Badge>
        {r.severity && (
          <Badge bg={blocker ? 'rgba(255,99,99,0.14)' : 'rgba(255,255,255,0.08)'} fg={blocker ? 'var(--gv-red-text)' : 'var(--gv-amber)'}>
            {severityLabel(r.severity)}
          </Badge>
        )}
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--gv-ink)' }}>{r.email ?? 'unknown'}</span>
        {r.beta_code
          ? <Badge bg="rgba(162,255,1,0.1)" fg={ACCENT_INK}>Beta · {r.beta_code}</Badge>
          : <span style={{ fontSize: 12, color: DIM }}>{r.plan ? cap(r.plan) : 'No plan'}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)' }}>
          {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* the message */}
      {r.headline && (
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gv-ink)', margin: '12px 0 5px' }}>
          “{r.headline}”
        </div>
      )}
      <p style={{ fontSize: 14, color: 'var(--gv-soft)', lineHeight: 1.65, margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>
        {r.body}
      </p>

      {/* context the customer never had to type */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '12px 0 0', fontSize: 12, color: 'var(--gv-faint)' }}>
        {r.area && <span>Area: {areaLabel(r.area)}</span>}
        {typeof r.rating === 'number' && <span>Rating: {r.rating}/5</span>}
        {typeof r.posts_published === 'number' && <span>{r.posts_published} posts published</span>}
        {r.responded_by && <span>Last touched by {r.responded_by}</span>}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
        <select
          value={r.status}
          onChange={(e) => onPatch(r.id, { status: e.target.value as FeedbackStatus }, 'status')}
          disabled={busy === r.id + 'status'}
          style={{
            padding: '7px 11px', borderRadius: 9, border: `1px solid ${LINE}`,
            background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)',
            fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
          }}>
          {FEEDBACK_STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>

        {r.kind === 'testimonial' && (
          canPublish ? (
            <button type="button" onClick={() => onPatch(r.id, { published: !r.published }, 'pub')}
              disabled={busy === r.id + 'pub'}
              style={{
                padding: '7px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                background: r.published ? 'rgba(255,255,255,0.05)' : ACCENT,
                border: `1px solid ${r.published ? LINE : ACCENT}`,
                color: r.published ? DIM : 'var(--gv-on-accent)',
              }}>
              {busy === r.id + 'pub' ? '…' : r.published ? 'Unpublish' : 'Publish to site'}
            </button>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--gv-faint)' }}>
              Not quotable — they didn&apos;t consent
            </span>
          )
        )}

        {r.email && (
          <a href={`mailto:${r.email}?subject=${encodeURIComponent('Re: your note about Grove')}`}
            style={{ fontSize: 13, fontWeight: 600, color: ACCENT_INK }}>
            Reply by email →
          </a>
        )}

        <button type="button" onClick={() => setNoteOpen((v) => !v)}
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: DIM }}>
          {r.owner_note ? 'Note ✎' : 'Add note'}
        </button>
      </div>

      {noteOpen && (
        <div style={{ marginTop: 12 }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            maxLength={FEEDBACK_LIMITS.ownerNote}
            placeholder="Private note — never shown to the customer."
            style={{
              width: '100%', padding: '10px 13px', borderRadius: 10, border: `1px solid ${LINE}`,
              background: 'rgba(255,255,255,0.03)', color: 'var(--gv-ink)',
              fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, resize: 'vertical',
            }} />
          <button type="button" onClick={() => { onPatch(r.id, { owner_note: note }, 'note'); setNoteOpen(false); }}
            disabled={busy === r.id + 'note'}
            style={{
              marginTop: 8, padding: '7px 14px', borderRadius: 9, border: `1px solid ${LINE}`,
              background: 'rgba(255,255,255,0.05)', color: 'var(--gv-ink)',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
            Save note
          </button>
        </div>
      )}
    </div>
  );
}

function Badge({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 999, background: bg, color: fg,
    }}>
      {children}
    </span>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
