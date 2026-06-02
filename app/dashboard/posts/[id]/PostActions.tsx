'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function PostActions({
  id, status, published, publicUrl, hasSocial,
}: { id: string; status: string; published: boolean; publicUrl: string | null; hasSocial: boolean }) {
  const r = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function genSocial() {
    setBusy('social');
    const res = await fetch(`/api/posts/${id}/social`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Social generation failed: ${j.error ?? 'unknown'}`);
    }
    r.refresh();
  }

  async function approve() {
    setBusy('approve');
    await fetch(`/api/posts/${id}/approve`, { method: 'POST' });
    setBusy(null);
    r.refresh();
  }
  async function retry() {
    setBusy('retry');
    const res = await fetch(`/api/posts/${id}/retry`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Retry failed: ${j.error ?? 'unknown'}`);
    }
    r.refresh();
  }
  async function del() {
    if (!confirm('Delete this post?')) return;
    setBusy('delete');
    await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    r.replace('/dashboard');
  }

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
      {status === 'review' && (
        <button className="btn btn-primary btn-sm" onClick={approve} disabled={!!busy}>
          {busy === 'approve' ? 'Publishing…' : 'Approve & publish'}
        </button>
      )}
      {(status === 'review' || status === 'published') && (
        <button className="btn btn-ghost btn-sm" onClick={genSocial} disabled={!!busy}>
          {busy === 'social' ? 'Adapting…' : hasSocial ? 'Regenerate social posts' : 'Generate social posts'}
        </button>
      )}
      {(status === 'failed' || status === 'review' || status === 'published') && (
        <button className="btn btn-ghost btn-sm" onClick={retry} disabled={!!busy}>
          {busy === 'retry' ? 'Regenerating…' : 'Regenerate'}
        </button>
      )}
      {published && publicUrl && (
        <a className="btn btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
          View live →
        </a>
      )}
      <button className="btn btn-ghost btn-sm" onClick={del} disabled={!!busy} style={{ marginLeft: 'auto', color: '#c33' }}>
        {busy === 'delete' ? '…' : 'Delete'}
      </button>
    </div>
  );
}
