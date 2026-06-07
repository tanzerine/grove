'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import LocalTime from './LocalTime';

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  queued: { cls: 'queue', label: 'QUEUED' },
  researching: { cls: 'queue', label: 'RESEARCHING' },
  writing: { cls: 'writing', label: 'WRITING' },
  review: { cls: 'writing', label: 'REVIEW' },
  scheduled: { cls: 'writing', label: 'SCHEDULED' },
  published: { cls: 'live', label: 'LIVE' },
  failed: { cls: 'queue', label: 'FAILED' },
};

// posts in-flight > STUCK_MIN minutes are almost certainly stuck
// (Vercel function ceiling is 300s; if it's been > 3 min something died)
const STUCK_MIN = 3;
const IN_FLIGHT = new Set(['queued', 'researching', 'writing']);

export default function PostRow({ p }: { p: any }) {
  const r = useRouter();
  const [busy, setBusy] = useState<null | 'retry' | 'delete'>(null);
  const b = STATUS_BADGE[p.status] ?? STATUS_BADGE.queued;
  const errorMsg = p.status === 'failed' ? (p.validation?.error ?? 'Unknown error') : null;
  const failedAt = p.validation?.failed_at;

  const ageMin = (Date.now() - new Date(p.created_at).getTime()) / 60_000;
  const stuck = IN_FLIGHT.has(p.status) && ageMin > STUCK_MIN;

  // surface latest log step so users see progress without clicking in
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
    ? STEP_LABELS[latest.step] ?? latest.step
    : null;

  async function retry() {
    if (busy) return;
    setBusy('retry');
    const res = await fetch(`/api/posts/${p.id}/retry`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Retry failed: ${j.error ?? 'unknown'}`);
    }
    r.refresh();
  }
  async function del() {
    if (busy) return;
    if (!confirm('Delete this post?')) return;
    setBusy('delete');
    await fetch(`/api/posts/${p.id}`, { method: 'DELETE' });
    setBusy(null);
    r.refresh();
  }

  const showRetry = p.status === 'failed' || stuck;
  const showDelete = p.status === 'failed' || stuck;

  return (
    <div className="post-row">
      <div className="pthumb" />
      <Link href={`/dashboard/posts/${p.id}`} className="pbody" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="ptitle" style={{ cursor: 'pointer' }}>{p.title ?? p.topic ?? '(no title yet)'}</div>
        <div className="pmeta">
          {p.status === 'published' ? <>Published{p.published_at ? <> · <LocalTime iso={p.published_at} withTime={false} /></> : ''} · {p.reads} reads</> :
           p.status === 'scheduled' ? (p.scheduled_at ? <><span style={{ color: '#7B9EF0' }}>● </span>Publishes <LocalTime iso={p.scheduled_at} /></> : 'Scheduled') :
           p.status === 'review' ? <>{p.validation?.stats?.word_count ?? '—'} words · awaiting your review{p.scheduled_at ? <> · planned for <LocalTime iso={p.scheduled_at} withTime={false} /></> : ''}</> :
           stuck ? <span style={{ color: '#c33' }}>Stuck at {p.status} for {Math.round(ageMin)}m — click Retry</span> :
           p.status === 'failed' ? <span style={{ color: '#c33' }}>Failed{failedAt ? ` at ${failedAt}` : ''}: {String(errorMsg).slice(0, 80)}</span> :
           currentStep ? <><span style={{ color: 'var(--moss)' }}>● </span>{currentStep}</> :
           p.status === 'writing' ? 'Drafting…' :
           p.status === 'researching' ? 'Gathering sources…' :
           p.topic}
        </div>
      </Link>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {showRetry && (
          <button className="qbtn go" onClick={retry} disabled={!!busy} style={{ background: 'var(--moss)', color: 'white' }}>
            {busy === 'retry' ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {showDelete && (
          <button className="qbtn" onClick={del} disabled={!!busy}>
            {busy === 'delete' ? '…' : 'Delete'}
          </button>
        )}
        {p.status === 'review' && (
          <button className="qbtn go" onClick={async () => {
            await fetch(`/api/posts/${p.id}/approve`, { method: 'POST' });
            r.refresh();
          }} style={{ background: 'var(--moss)', color: 'white' }}>
            Approve
          </button>
        )}
        <span className={`badge ${b.cls}`}><span className="d" />{b.label}</span>
      </div>
    </div>
  );
}
