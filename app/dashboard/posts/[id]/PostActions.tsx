'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import Icon from '../../gv-icons';
import { captureClient } from '@/lib/analytics/capture-client';
import type { ViewLiveTarget } from '@/lib/embed-seo';

export default function PostActions({
  id, status, published, live, hasCover, hasInlineImages, children,
}: { id: string; status: string; published: boolean; live: ViewLiveTarget | null; hasCover: boolean; hasInlineImages: boolean; children?: React.ReactNode }) {
  const r = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function approve() {
    setBusy('approve');
    captureClient('post_approved', { post_id: id });
    await fetch(`/api/posts/${id}/approve`, { method: 'POST' });
    setBusy(null);
    r.refresh();
  }
  // "Regenerate" on a finished draft means a NEW article, so it asks for a
  // fresh run; a failed post resumes from the step that broke instead, which is
  // both cheaper and what the button means there.
  async function retry() {
    const rewrite = status !== 'failed';
    if (rewrite && !confirm('Rewrite this article from scratch? This replaces the current draft.')) return;
    captureClient('post_regenerated', { post_id: id, mode: rewrite ? 'fresh' : 'resume' });
    setBusy('retry');
    const res = await fetch(`/api/posts/${id}/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: rewrite ? 'fresh' : 'resume' }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`${rewrite ? 'Regenerate' : 'Retry'} failed: ${j.error ?? 'unknown'}`);
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
    captureClient('post_deleted', { post_id: id, post_status: status });
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
      {/* The host rides along with the label. A customer with two blog surfaces
          (grove's subdomain and their own site's copy) can't otherwise tell
          which one this opens, and one with none can't tell it's leaving their
          domain entirely. */}
      {published && live && (
        <a className="gv-tool" style={{ ...tool, textDecoration: 'none' }} href={live.url} target="_blank" rel="noreferrer">
          <Icon name="view" size={14} /> View live
          {live.host && (
            <span style={{ fontWeight: 500, color: live.offDomain ? 'var(--gv-amber)' : 'var(--gv-faint)' }}>
              {live.host}
            </span>
          )}
        </a>
      )}
      {(status === 'failed' || status === 'review' || status === 'scheduled' || status === 'published') && (
        <button className="gv-tool" style={tool} onClick={retry} disabled={!!busy}>
          <Icon name="refresh" size={14} />
          {status === 'failed'
            ? (busy === 'retry' ? 'Retrying…' : 'Retry')
            : (busy === 'retry' ? 'Regenerating…' : 'Regenerate')}
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

      {/* Last child + flexBasis:100% so it wraps onto its own row under the
          buttons instead of splitting them. Published, on grove's domain, and
          nothing in the product said so at the one moment the customer is
          looking straight at it. */}
      {published && live?.warning && (
        <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 4, background: 'rgba(224,200,120,0.08)', border: '1px solid rgba(224,200,120,0.28)', borderRadius: 12, padding: '12px 14px' }}>
          <span style={{ display: 'flex', color: 'var(--gv-amber)', flexShrink: 0, marginTop: 1 }}><Icon name="alert" size={15} /></span>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--gv-soft)' }}>
            <b style={{ color: 'var(--gv-amber)' }}>This article is published on grove&rsquo;s domain, not yours.</b>{' '}
            {live.warning}{' '}
            <Link href="/dashboard/embed" style={{ color: 'var(--gv-accent)', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Connect your domain →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
