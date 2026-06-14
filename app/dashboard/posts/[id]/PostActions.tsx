'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function PostActions({
  id, status, published, publicUrl, hasSocial, hasCover, hasInlineImages,
}: { id: string; status: string; published: boolean; publicUrl: string | null; hasSocial: boolean; hasCover: boolean; hasInlineImages: boolean }) {
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
  async function genInlineImages() {
    setBusy('inline');
    const res = await fetch(`/api/posts/${id}/inline-images`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Inline image generation failed: ${j.error ?? 'unknown'}`);
    }
    r.refresh();
  }

  async function genCover() {
    setBusy('cover');
    const res = await fetch(`/api/posts/${id}/cover`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Cover generation failed: ${j.error ?? 'unknown'}`);
    }
    r.refresh();
  }

  async function shareNow() {
    setBusy('share');
    const res = await fetch(`/api/posts/${id}/share`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      alert(`Share failed: ${j.error ?? 'unknown'}`);
    } else {
      const lines = Object.entries(j.result ?? {}).map(([ch, r]: [string, any]) =>
        r?.error ? `${ch}: failed — ${r.error}` : r?.dry_run ? `${ch}: dry run` : `${ch}: shared ✓`);
      alert(lines.length ? lines.join('\n') : 'Nothing to share yet.');
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
      {(status === 'failed' || status === 'review' || status === 'scheduled' || status === 'published') && (
        <button className="btn btn-ghost btn-sm" onClick={retry} disabled={!!busy}>
          {busy === 'retry' ? 'Regenerating…' : 'Regenerate'}
        </button>
      )}
      {!hasCover && (status === 'review' || status === 'published' || status === 'scheduled') && (
        <button className="btn btn-ghost btn-sm" onClick={genCover} disabled={!!busy}>
          {busy === 'cover' ? 'Generating cover…' : 'Generate cover image'}
        </button>
      )}
      {hasCover && !hasInlineImages && (status === 'review' || status === 'published' || status === 'scheduled') && (
        <button className="btn btn-ghost btn-sm" onClick={genInlineImages} disabled={!!busy}>
          {busy === 'inline' ? 'Generating images…' : 'Add inline images'}
        </button>
      )}
      {published && (
        <button className="btn btn-ghost btn-sm" onClick={shareNow} disabled={!!busy}>
          {busy === 'share' ? 'Sharing…' : 'Share to socials'}
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
