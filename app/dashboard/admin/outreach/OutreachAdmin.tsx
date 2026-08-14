'use client';
import { useMemo, useState } from 'react';
import { PAIN_LABEL, TIER_LABEL, type PainKind, type Tier } from '@/lib/outreach/screen';
import type { ProspectRow, ProspectStatus } from '@/lib/outreach/store';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const LINE = 'rgba(255,255,255,0.08)';
const DIM = 'var(--gv-dim)';

const TIER_STYLE: Record<Tier, { bg: string; fg: string }> = {
  strong: { bg: 'rgba(162,255,1,0.14)', fg: ACCENT_INK },
  worth_a_look: { bg: 'rgba(255,255,255,0.1)', fg: 'var(--gv-amber)' },
  skip: { bg: 'rgba(255,99,99,0.14)', fg: 'var(--gv-red-text)' },
};

type Filter = 'new' | 'contacted' | 'replied' | 'joined' | 'skipped' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'new', label: 'To review' },
  { id: 'contacted', label: 'Sent' },
  { id: 'replied', label: 'Replied' },
  { id: 'joined', label: 'Joined' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'all', label: 'Everything' },
];

/**
 * The outreach desk: run a scan, read the evidence, send or skip.
 *
 * There is no send button and there never should be. The copy button plus a
 * "mark sent" is the whole interaction, because the review step between a
 * regex score and a real person's inbox is the only thing keeping this from
 * being a spam cannon. Everything on the card is arranged to make that review
 * cheap: the author's own quoted sentences, the blockers, then the draft.
 */
export default function OutreachAdmin({
  initialRows,
  couponCodes,
}: {
  initialRows: ProspectRow[];
  couponCodes: { code: string; label: string | null; postsQuota: number; days: number }[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>('new');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // Scan controls. Defaults are the ones worth running most days: this week's
  // posts, a coupon attached, model-written openers on.
  const [couponCode, setCouponCode] = useState(couponCodes[0]?.code ?? '');
  const [time, setTime] = useState<'day' | 'week' | 'month'>('week');
  const [drafts, setDrafts] = useState(10);
  const [personalize, setPersonalize] = useState(true);
  const [minTier, setMinTier] = useState<'strong' | 'worth_a_look'>('worth_a_look');

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { new: 0, contacted: 0, replied: 0, joined: 0, skipped: 0, all: rows.length };
    for (const r of rows) c[r.status as Filter]++;
    return c;
  }, [rows]);

  async function scan() {
    if (scanning) return;
    setErr(null);
    setScanNote(null);
    setScanning(true);
    const res = await fetch('/api/admin/outreach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ couponCode: couponCode || undefined, time, drafts, personalize, minTier }),
    });
    const j = await res.json().catch(() => ({}));
    setScanning(false);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'The scan failed.');

    setRows((rs) => [...(j.prospects ?? []), ...rs]);
    setFilter('new');
    const s = j.stats ?? {};
    setScanNote(
      `Read ${s.scanned ?? 0} posts across ${s.queried ?? 0} queries · ${s.qualified ?? 0} passed screening · ` +
        `${s.drafted ?? 0} drafted · skipped ${s.alreadyKnown ?? 0} people already in the list` +
        (j.errors?.length ? ` · ${j.errors.length} request(s) failed` : ''),
    );
  }

  async function patch(id: string, body: Record<string, unknown>, tag: string) {
    setErr(null);
    setBusy(id + tag);
    const res = await fetch(`/api/admin/outreach/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.message ?? j.error ?? 'Update failed.');
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...(j.prospect ?? body) } : r)));
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      {/* ── scan controls ─────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--gv-card)', border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--gv-ink)', marginBottom: 14 }}>Find prospects</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Field label="Beta code to offer" hint={couponCodes.length ? 'live codes only' : 'create one first'}>
            <select value={couponCode} onChange={(e) => setCouponCode(e.target.value)} style={inputStyle}>
              <option value="">No code — ask for a reply</option>
              {couponCodes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.postsQuota}/mo · {c.days}d{c.label ? ` · ${c.label}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Posted within">
            <select value={time} onChange={(e) => setTime(e.target.value as typeof time)} style={inputStyle}>
              <option value="day">Last 24 hours</option>
              <option value="week">Last week</option>
              <option value="month">Last month</option>
            </select>
          </Field>
          <Field label="Draft at most">
            <input type="number" min={1} max={20} value={drafts}
              onChange={(e) => setDrafts(Number(e.target.value))} style={inputStyle} />
          </Field>
          <Field label="Include">
            <select value={minTier} onChange={(e) => setMinTier(e.target.value as typeof minTier)} style={inputStyle}>
              <option value="worth_a_look">Strong + worth a look</option>
              <option value="strong">Strong fits only</option>
            </select>
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: DIM, cursor: 'pointer' }}>
          <input type="checkbox" checked={personalize} onChange={(e) => setPersonalize(e.target.checked)} />
          Write the opening line with the model (slower, reads far less like a template)
        </label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" onClick={scan} disabled={scanning}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 600, cursor: scanning ? 'default' : 'pointer',
              background: scanning ? 'rgba(255,255,255,0.08)' : ACCENT,
              color: scanning ? 'var(--gv-faint)' : 'var(--gv-on-accent)',
            }}>
            {scanning ? 'Scanning Reddit…' : 'Scan Reddit'}
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--gv-faint)', maxWidth: 520, lineHeight: 1.5 }}>
            Nothing is sent. Every draft is copied out by you — and anyone already in this list is
            never surfaced again, whatever they post.
          </span>
        </div>
        {scanNote && (
          <p style={{ fontSize: 12.5, color: ACCENT_INK, margin: '12px 0 0', lineHeight: 1.55 }}>{scanNote}</p>
        )}
      </div>

      {/* ── triage ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              style={{
                padding: '7px 13px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                background: on ? ACCENT : 'rgba(255,255,255,0.03)',
                border: `1px solid ${on ? ACCENT : LINE}`,
                color: on ? 'var(--gv-on-accent)' : DIM,
              }}>
              {f.label}{counts[f.id] ? ` · ${counts[f.id]}` : ''}
            </button>
          );
        })}
      </div>

      {err && <p style={{ color: 'var(--gv-red-text)', fontSize: 13.5, marginBottom: 14 }}>{err}</p>}

      {shown.length === 0 ? (
        <p style={{ color: DIM, fontSize: 14, lineHeight: 1.6 }}>
          {rows.length === 0
            ? 'Nothing here yet. Run a scan — it reads the founder subreddits for people describing a problem Grove solves, and drafts a message for the best of them.'
            : 'Nothing in this view.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((r) => <Card key={r.id} row={r} busy={busy} onPatch={patch} />)}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── one prospect ────────────────────────────── */

function Card({
  row: r,
  busy,
  onPatch,
}: {
  row: ProspectRow;
  busy: string | null;
  onPatch: (id: string, body: Record<string, unknown>, tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(r.dm_body ?? '');
  const [copied, setCopied] = useState(false);
  const tier = TIER_STYLE[r.tier] ?? TIER_STYLE.skip;
  const hardBlockers = (r.blockers ?? []).filter((b) => b.hard);
  const softBlockers = (r.blockers ?? []).filter((b) => !b.hard);

  async function copy() {
    const text = `Subject: ${r.dm_subject ?? ''}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ background: 'var(--gv-card)', border: `1px solid ${hardBlockers.length ? 'rgba(255,99,99,0.28)' : LINE}`, borderRadius: 14, padding: '15px 17px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: tier.bg, color: tier.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {TIER_LABEL[r.tier] ?? r.tier} · {r.fit}
        </span>
        <a href={r.post_url ?? '#'} target="_blank" rel="noreferrer"
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--gv-ink)', textDecoration: 'none' }}>
          u/{r.author}
        </a>
        <span style={{ fontSize: 12.5, color: 'var(--gv-faint)' }}>
          r/{r.subreddit} · {r.posted_at ? relTime(r.posted_at) : 'unknown date'}
        </span>
        {r.pain && (
          <span style={{ fontSize: 12, color: DIM }}>
            · {PAIN_LABEL[r.pain as PainKind] ?? r.pain}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--gv-faint)' }}>
          {r.status !== 'new' ? r.status : ''}
        </span>
      </div>

      <a href={r.post_url ?? '#'} target="_blank" rel="noreferrer"
        style={{ display: 'block', fontSize: 13.5, color: 'var(--gv-soft)', margin: '9px 0 0', textDecoration: 'none' }}>
        {r.post_title}
      </a>

      {/* the evidence — the reason this card exists */}
      {(r.evidence ?? []).length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {r.evidence.slice(0, 3).map((e, i) => (
            <li key={i} style={{ fontSize: 12.5, color: DIM, lineHeight: 1.5, borderLeft: `2px solid ${LINE}`, paddingLeft: 9 }}>
              “{e.quote}”
            </li>
          ))}
        </ul>
      )}

      {/* blockers */}
      {hardBlockers.map((b, i) => (
        <p key={i} style={{ fontSize: 12.5, color: 'var(--gv-red-text)', margin: '10px 0 0', fontWeight: 600 }}>
          Don’t send — {b.label}.
        </p>
      ))}
      {softBlockers.map((b, i) => (
        <p key={i} style={{ fontSize: 12.5, color: 'var(--gv-amber)', margin: '7px 0 0' }}>{b.label}</p>
      ))}

      {/* the draft */}
      <div style={{ marginTop: 12, display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={linkBtn}>
          {open ? 'Hide draft' : 'Show draft'}
        </button>
        <button type="button" onClick={copy} style={linkBtn}>{copied ? 'Copied ✓' : 'Copy DM'}</button>
        <a href={`https://www.reddit.com/message/compose/?to=${encodeURIComponent(r.author)}&subject=${encodeURIComponent(r.dm_subject ?? '')}`}
          target="_blank" rel="noreferrer" style={linkBtn}>Open Reddit compose ↗</a>
        {!r.personalized && (
          <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>template opener — rewrite line one</span>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 5 }}>
            Subject: <span style={{ color: DIM }}>{r.dm_subject}</span>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`,
              borderRadius: 10, padding: '11px 13px', color: 'var(--gv-ink)', fontSize: 13.5,
              lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical',
            }} />
          <div style={{ display: 'flex', gap: 9, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={body === r.dm_body || busy === r.id + 'save'}
              onClick={() => onPatch(r.id, { dm_body: body }, 'save')} style={linkBtn}>
              {busy === r.id + 'save' ? 'Saving…' : 'Save edits'}
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>
              {body.trim().split(/\s+/).filter(Boolean).length} words
            </span>
          </div>
        </div>
      )}

      {/* funnel */}
      <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
        {(['contacted', 'replied', 'joined', 'skipped'] as ProspectStatus[]).map((s) => (
          <button key={s} type="button" disabled={r.status === s || busy === r.id + s}
            onClick={() => onPatch(r.id, { status: s }, s)}
            style={{
              ...linkBtn,
              opacity: r.status === s ? 0.45 : 1,
              borderColor: r.status === s ? ACCENT : LINE,
              color: r.status === s ? ACCENT_INK : DIM,
            }}>
            {s === 'contacted' ? 'Mark sent' : s === 'skipped' ? 'Skip' : s === 'replied' ? 'They replied' : 'They joined'}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────── bits ───────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`,
  borderRadius: 9, padding: '9px 11px', color: 'var(--gv-ink)', fontSize: 13.5, fontFamily: 'inherit',
};

const linkBtn: React.CSSProperties = {
  padding: '6px 11px', borderRadius: 8, border: `1px solid ${LINE}`, background: 'transparent',
  color: DIM, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  textDecoration: 'none', display: 'inline-block',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', marginBottom: 5 }}>
        {label}{hint ? <span style={{ opacity: 0.7 }}> · {hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

function relTime(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return 'unknown date';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
