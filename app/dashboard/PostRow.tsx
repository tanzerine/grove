'use client';
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

export default function PostRow({ p }: { p: any }) {
  const r = useRouter();
  const [busy, setBusy] = useState<null | 'retry' | 'delete'>(null);
  const b = STATUS_BADGE[p.status] ?? STATUS_BADGE.queued;
  const errorMsg = p.status === 'failed' ? (p.validation?.error ?? 'Unknown error') : null;

  async function retry() {
    if (busy) return;
    setBusy('retry');
    const res = await fetch(`/api/posts/${p.id}/retry`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Retry failed: ${j.error ?? 'unknown error'}`);
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

  return (
    <div className="post-row">
      <div className="pthumb" />
      <div className="pbody">
        <div className="ptitle">{p.title ?? p.topic ?? '(no title yet)'}</div>
        <div className="pmeta">
          {p.status === 'published' ? `Published · ${p.reads} reads` :
           p.status === 'review' ? `${p.validation?.stats?.word_count ?? '—'} words · awaiting your review` :
           p.status === 'writing' ? 'Drafting…' :
           p.status === 'researching' ? 'Gathering sources…' :
           p.status === 'failed' ? <span style={{ color: '#c33' }}>Failed: {String(errorMsg).slice(0, 90)}</span> :
           p.topic}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {p.status === 'failed' && (
          <>
            <button className="qbtn go" onClick={retry} disabled={!!busy} style={{ background: 'var(--moss)', color: 'white' }}>
              {busy === 'retry' ? 'Retrying…' : 'Retry'}
            </button>
            <button className="qbtn" onClick={del} disabled={!!busy}>
              {busy === 'delete' ? '…' : 'Delete'}
            </button>
          </>
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
