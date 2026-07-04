'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import LocalTime from './LocalTime';
import Icon from './gv-icons';

const ACCENT = 'var(--gv-accent)';

// posts in-flight > STUCK_MIN minutes are almost certainly stuck
// (Vercel function ceiling is 300s; if it's been > 3 min something died)
const STUCK_MIN = 3;
const IN_FLIGHT = new Set(['queued', 'researching', 'writing']);

// icon + accent treatment per status
function visuals(status: string, stuck: boolean) {
  if (stuck || status === 'failed') return { icon: 'alert', accent: false, danger: true };
  if (status === 'published') return { icon: 'globe', accent: true, danger: false };
  if (status === 'review') return { icon: 'eye', accent: false, danger: false };
  if (status === 'scheduled') return { icon: 'doc', accent: false, danger: false };
  if (status === 'writing') return { icon: 'pen', accent: true, danger: false };
  return { icon: 'search2', accent: true, danger: false };
}

export default function PostRow({ p, score, blogSlug }: { p: any; score?: { overall: number; action: string } | null; blogSlug?: string | null }) {
  const r = useRouter();
  const [busy, setBusy] = useState<null | 'retry' | 'delete' | 'regen' | 'approve'>(null);
  const errorMsg = p.status === 'failed' ? (p.validation?.error ?? 'Unknown error') : null;
  const failedAt = p.validation?.failed_at;

  const ageMin = (Date.now() - new Date(p.created_at).getTime()) / 60_000;
  const stuck = IN_FLIGHT.has(p.status) && ageMin > STUCK_MIN;
  const v = visuals(p.status, stuck);

  const STEP_LABELS: Record<string, string> = {
    site_profile: 'Crawling your site…',
    research: 'Searching the web…',
    topic_refiner: 'Picking an angle…',
    writer: 'Drafting the article…',
    persist: 'Saving draft…',
    cover_image: 'Finding cover image…',
  };
  const log = (p.generation_log ?? []) as { step: string; event: string; message?: string }[];
  const latest = log.length ? log[log.length - 1] : null;
  const currentStep = IN_FLIGHT.has(p.status) && latest && latest.event === 'start'
    ? STEP_LABELS[latest.step] ?? latest.step : null;
  const inFlight = IN_FLIGHT.has(p.status) && !stuck;

  async function retry() {
    if (busy) return; setBusy('retry');
    const res = await fetch(`/api/posts/${p.id}/retry`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(`Retry failed: ${j.error ?? 'unknown'}`); }
    r.refresh();
  }
  async function del() {
    if (busy) return; if (!confirm('Delete this post?')) return; setBusy('delete');
    await fetch(`/api/posts/${p.id}`, { method: 'DELETE' }); setBusy(null); r.refresh();
  }
  async function regenerate() {
    if (busy) return; if (!confirm('Rewrite this article from scratch? This replaces the current draft.')) return; setBusy('regen');
    const res = await fetch(`/api/posts/${p.id}/retry`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(`Regenerate failed: ${j.error ?? 'unknown'}`); }
    r.refresh();
  }
  async function approve() {
    if (busy) return; setBusy('approve');
    await fetch(`/api/posts/${p.id}/approve`, { method: 'POST' }); setBusy(null); r.refresh();
  }

  const showRetry = p.status === 'failed' || stuck;
  const showDelete = p.status === 'failed' || stuck;
  const showRegen = ['review', 'scheduled', 'published'].includes(p.status);

  const scoreColor = !score ? 'var(--gv-faint)' : score.overall >= 70 ? ACCENT : score.overall >= 40 ? 'var(--gv-amber)' : 'var(--gv-red)';
  const metaColor = v.danger ? '#c98f8f' : 'var(--gv-dim)';

  const meta: React.ReactNode =
    p.status === 'published' ? <>Live{p.published_at ? <> · <LocalTime iso={p.published_at} withTime={false} /></> : ''}{typeof p.reads === 'number' ? ` · ${p.reads} reads` : ''}</> :
    p.status === 'scheduled' ? (p.scheduled_at ? <>Publishes <LocalTime iso={p.scheduled_at} /></> : 'Scheduled') :
    p.status === 'review' ? <>{p.validation?.stats?.word_count ?? '—'} words · ready for you</> :
    stuck ? `Stuck at ${p.status} for ${Math.round(ageMin)}m — click Retry` :
    p.status === 'failed' ? `Failed${failedAt ? ` at ${failedAt}` : ''}: ${String(errorMsg).slice(0, 60)}` :
    currentStep ? currentStep :
    p.status === 'writing' ? 'Drafting…' : p.status === 'researching' ? 'Gathering sources…' : (p.topic ?? 'Queued');

  const btn = (label: string, onClick: () => void, primary = false, key?: string) => (
    <button key={key} className="gv-btn" onClick={onClick} disabled={!!busy}
      style={{ border: `1px solid ${primary ? ACCENT : 'rgba(255,255,255,0.12)'}`, background: primary ? ACCENT : 'rgba(255,255,255,0.03)', color: primary ? 'var(--gv-on-accent)' : 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 15px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {label}
    </button>
  );

  return (
    <div className="gv-prow" style={{ background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: v.accent ? 'rgba(99,194,129,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${v.accent ? 'rgba(99,194,129,0.2)' : 'rgba(255,255,255,0.07)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: v.danger ? 'var(--gv-red)' : v.accent ? ACCENT : 'var(--gv-dim)', flexShrink: 0 }}>
          <Icon name={v.icon} size={18} />
        </span>
        <Link href={`/dashboard/posts/${p.id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{p.title ?? p.topic ?? '(no title yet)'}</div>
          <div style={{ fontSize: 12, color: metaColor, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
            {inFlight && <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, flexShrink: 0, animation: 'gvPulse 1.8s ease-in-out infinite' }} />}
            {meta}
          </div>
        </Link>

        {score ? (
          <span title={`Manager quality score · last decision: ${score.action}`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2, flexShrink: 0, fontVariantNumeric: 'tabular-nums', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 9px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{score.overall}</span>
            <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>score</span>
          </span>
        ) : null}

        <div className="pactions" style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {p.status === 'review' && btn(busy === 'approve' ? '…' : 'Approve', approve, true, 'a')}
          {showRetry && btn(busy === 'retry' ? 'Retrying…' : 'Retry', retry, true, 'r')}
          {showRegen && btn(busy === 'regen' ? '…' : 'Regenerate', regenerate, false, 'g')}
          {showDelete && btn(busy === 'delete' ? '…' : 'Delete', del, false, 'd')}
          {p.status === 'published' && blogSlug && p.slug && (
            <a className="gv-btn" href={`/b/${blogSlug}/${p.slug}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'var(--gv-soft)', fontSize: 12.5, fontWeight: 600, padding: '7px 15px', borderRadius: 9, textDecoration: 'none', whiteSpace: 'nowrap' }}>View ↗</a>
          )}
        </div>
      </div>

      {inFlight && (
        <div style={{ marginTop: 13 }}>
          <div style={{ position: 'relative', height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', borderRadius: 99, background: ACCENT, opacity: 0.55, animation: 'gvIndet 1.6s ease-in-out infinite' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10 }}>
            <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
              <span className="gv-think" />
              <span className="gv-think" style={{ animationDelay: '.15s' }} />
              <span className="gv-think" style={{ animationDelay: '.3s' }} />
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--gv-soft)', fontWeight: 500, flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentStep ?? (p.status === 'writing' ? 'Drafting the article…' : p.status === 'researching' ? 'Researching live SERP…' : 'Working…')}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--gv-fainter)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {p.status === 'researching' || p.status === 'queued' ? 'research' : 'draft'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
