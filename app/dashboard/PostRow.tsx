'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  queued: { cls: 'queue', label: 'QUEUED' },
  researching: { cls: 'queue', label: 'RESEARCHING' },
  writing: { cls: 'writing', label: 'WRITING' },
  review: { cls: 'writing', label: 'REVIEW' },
  scheduled: { cls: 'writing', label: 'SCHEDULED' },
  published: { cls: 'live', label: 'LIVE' },
  failed: { cls: 'queue', label: 'FAILED' },
};

// posts in these statuses for > STUCK_MIN minutes are almost certainly stuck.
const STUCK_MIN = 5;
const IN_FLIGHT = new Set(['queued', 'researching', 'writing']);

export default function PostRow({ p }: { p: any }) {
  const r = useRouter();
  const [busy, setBusy] = useState<null | 'retry' | 'delete'>(null);
  const b = STATUS_BADGE[p.status] ?? STATUS_BADGE.queued;
  const errorMsg = p.status === 'failed' ? (p.validation?.error ?? 'Unknown error') : null;
  const failedAt = p.validation?.failed_at;

  const ageMin = (Date.now() - new Date(p.created_at).getTime()) / 60_000;
  const stuck = IN_FLIGHT.has(p.status) && ageMin > STUCK_MIN;

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
          {p.status === 'published' ? `Published · ${p.reads} reads` :
           p.status === 'review' ? `${p.validation?.stats?.word_count ?? '—'} words · awaiting your review` :
           stuck ? <span style={{ color: '#c33' }}>Stuck at {p.status} for {Math.round(ageMin)}m — click Retry</span> :
           p.status === 'writing' ? 'Drafting…' :
           p.status === 'researching' ? 'Gathering sources…' :
           p.status === 'failed' ? <span style={{ color: '#c33' }}>Failed{failedAt ? ` at ${failedAt}` : ''}: {String(errorMsg).slice(0, 80)}</span> :
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
