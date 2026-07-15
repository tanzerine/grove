'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function PostActions({
  id, status, published, publicUrl, hasCover, hasInlineImages,
}: { id: string; status: string; published: boolean; publicUrl: string | null; hasCover: boolean; hasInlineImages: boolean }) {
  const r = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

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

  async function del() {
    if (!confirm('Delete this post?')) return;
    setBusy('delete');
    await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    r.replace('/dashboard');
  }

  const ACCENT = 'var(--gv-accent)';
  const primary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 10, cursor: 'pointer' };
  const ghost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '10px 16px', borderRadius: 10, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', gap: 9, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' }}>
      {status === 'review' && (
        <button className="gv-btn" style={primary} onClick={approve} disabled={!!busy}>
          {busy === 'approve' ? 'Publishing…' : 'Approve & publish'}
        </button>
      )}
      {(status === 'failed' || status === 'review' || status === 'scheduled' || status === 'published') && (
        <button className="gv-ghost" style={ghost} onClick={retry} disabled={!!busy}>
          {busy === 'retry' ? 'Regenerating…' : 'Regenerate'}
        </button>
      )}
      {!hasCover && (status === 'review' || status === 'published' || status === 'scheduled') && (
        <button className="gv-ghost" style={ghost} onClick={genCover} disabled={!!busy}>
          {busy === 'cover' ? 'Generating cover…' : 'Generate cover image'}
        </button>
      )}
      {hasCover && !hasInlineImages && (status === 'review' || status === 'published' || status === 'scheduled') && (
        <button className="gv-ghost" style={ghost} onClick={genInlineImages} disabled={!!busy}>
          {busy === 'inline' ? 'Generating images…' : 'Add inline images'}
        </button>
      )}
      {published && publicUrl && (
        <a className="gv-ghost" style={{ ...ghost, textDecoration: 'none' }} href={publicUrl} target="_blank" rel="noreferrer">
          View live →
        </a>
      )}
      <button className="gv-ghost" style={{ ...ghost, marginLeft: 'auto', color: 'var(--gv-red-soft)' }} onClick={del} disabled={!!busy}>
        {busy === 'delete' ? '…' : 'Delete'}
      </button>
    </div>
  );
}
