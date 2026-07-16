'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Icon from '../../gv-icons';

export default function PostActions({
  id, status, published, publicUrl, hasCover, hasInlineImages, children,
}: { id: string; status: string; published: boolean; publicUrl: string | null; hasCover: boolean; hasInlineImages: boolean; children?: React.ReactNode }) {
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

  const primary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'var(--gv-accent)', color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '9px 16px', borderRadius: 9, cursor: 'pointer' };
  const tool: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 9, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
      {status === 'review' && (
        <button className="gv-btn" style={primary} onClick={approve} disabled={!!busy}>
          <Icon name="check" size={15} /> {busy === 'approve' ? 'Publishing…' : 'Approve & publish'}
        </button>
      )}
      {published && publicUrl && (
        <a className="gv-tool" style={{ ...tool, textDecoration: 'none' }} href={publicUrl} target="_blank" rel="noreferrer">
          <Icon name="view" size={14} /> View live
        </a>
      )}
      {(status === 'failed' || status === 'review' || status === 'scheduled' || status === 'published') && (
        <button className="gv-tool" style={tool} onClick={retry} disabled={!!busy}>
          <Icon name="refresh" size={14} /> {busy === 'retry' ? 'Regenerating…' : 'Regenerate'}
        </button>
      )}
      {!hasCover && (status === 'review' || status === 'published' || status === 'scheduled') && (
        <button className="gv-tool" style={tool} onClick={genCover} disabled={!!busy}>
          <Icon name="image" size={14} /> {busy === 'cover' ? 'Generating cover…' : 'Generate cover image'}
        </button>
      )}
      {hasCover && !hasInlineImages && (status === 'review' || status === 'published' || status === 'scheduled') && (
        <button className="gv-tool" style={tool} onClick={genInlineImages} disabled={!!busy}>
          <Icon name="image" size={14} /> {busy === 'inline' ? 'Generating images…' : 'Add inline images'}
        </button>
      )}
      {children}
      <button className="gv-tool gv-danger" style={{ ...tool, marginLeft: 'auto', background: 'transparent', color: 'var(--gv-dim)' }} onClick={del} disabled={!!busy}>
        <Icon name="trash" size={14} /> {busy === 'delete' ? '…' : 'Delete'}
      </button>
    </div>
  );
}
