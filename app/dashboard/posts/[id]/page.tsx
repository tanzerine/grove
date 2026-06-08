import { supabaseServer } from '@/lib/supabase/server';
import { mdToHtml } from '@/lib/markdown';
import { notFound } from 'next/navigation';
import PostActions from './PostActions';
import PipelineTimeline from './PipelineTimeline';
import RichEditor from './RichEditor';
import LocalTime from '../../LocalTime';
import Link from 'next/link';

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: p } = await sb.from('posts').select('*, domains(blog_slug,hostname)').eq('id', id).single();
  if (!p) notFound();
  const domain = (p as any).domains;

  const social = (p.social ?? {}) as { x?: string; linkedin?: string; instagram?: string };
  const validation = p.validation as { passed?: boolean; issues?: string[]; stats?: Record<string, number>; error?: string } | null;
  const bodyHtml = p.body_md ? mdToHtml(p.body_md) : '';

  // Detect inline images: count ![...](...) that appear after an H2 line
  const hasInlineImages = (() => {
    if (!p.body_md) return false;
    const lines = p.body_md.split('\n');
    let pastH2 = false; let count = 0;
    for (const l of lines) {
      if (/^##\s/.test(l)) pastH2 = true;
      if (pastH2 && /^!\[.+\]\(.+\)/.test(l.trim())) count++;
    }
    return count >= 2;
  })();

  return (
    <>
      <Link href="/dashboard" className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>← Pipeline</Link>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14, gap: 24 }}>
        <h1 style={{ fontFamily: 'Clash Display', fontSize: 32, margin: 0, lineHeight: 1.15 }}>
          {p.title ?? p.topic ?? '(no title)'}
        </h1>
        <StatusBadge status={p.status} />
      </div>
      <p className="mono" style={{ fontSize: 12, color: 'var(--clay)', marginTop: 4 }}>
        Topic: {p.topic} · {validation?.stats?.word_count ? `${validation.stats.word_count} words · ` : ''}{validation?.stats?.citation_count ?? 0} citations
      </p>

      {p.status === 'scheduled' && p.scheduled_at && (
        <ScheduleLine color="#7B9EF0">Publishes <strong><LocalTime iso={p.scheduled_at} /></strong> (your local time)</ScheduleLine>
      )}
      {p.status === 'review' && p.scheduled_at && (
        <ScheduleLine color="#E0A040">Planned for <strong><LocalTime iso={p.scheduled_at} /></strong> — approve to lock it in</ScheduleLine>
      )}
      {p.status === 'published' && p.published_at && (
        <ScheduleLine color="var(--moss)">Published <strong><LocalTime iso={p.published_at} /></strong></ScheduleLine>
      )}

      <PostActions
        id={p.id}
        status={p.status}
        published={p.status === 'published'}
        publicUrl={p.status === 'published' ? `/b/${domain?.blog_slug}/${p.slug}` : null}
        hasSocial={!!(social.x || social.linkedin || social.instagram)}
        hasCover={!!p.cover_image_url}
        hasInlineImages={hasInlineImages}
      />

      {p.status === 'failed' && (
        <div style={{ background: '#fdecec', border: '1px solid #f5b5b5', color: '#a33', padding: 18, borderRadius: 10, marginTop: 20 }}>
          <b>Generation failed.</b>
          <div className="mono" style={{ fontSize: 12, marginTop: 6 }}>{validation?.error ?? 'Unknown error'}</div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <PipelineTimeline log={(p.generation_log ?? []) as any} status={p.status} />
      </div>

      {validation?.issues && validation.issues.length > 0 && (
        <div style={{ background: '#fef9e8', border: '1px solid #f0d674', padding: 16, borderRadius: 10, marginTop: 20 }}>
          <b style={{ fontSize: 13 }}>Quality flags from validator</b>
          <ul style={{ margin: '8px 0 0 18px', fontSize: 13 }}>
            {validation.issues.map((i, idx) => <li key={idx} className="mono">{i}</li>)}
          </ul>
        </div>
      )}

      {/* Single article block: rendered, and editable in place for finished posts. */}
      {p.body_md && (['review', 'scheduled', 'published'].includes(p.status) ? (
        <RichEditor
          postId={p.id}
          initialBody={p.body_md}
          initialMetaTitle={p.meta_title ?? ''}
          initialMetaDesc={p.meta_description ?? ''}
          canEdit
        />
      ) : bodyHtml ? (
        <article
          className="prose"
          style={{ marginTop: 16, padding: '36px 44px', background: 'white', border: '1px solid var(--line)', borderRadius: 14, maxWidth: 'none' }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : null)}

      {(social.x || social.linkedin || social.instagram) && (
        <>
          <h3 style={{ fontFamily: 'Clash Display', fontSize: 22, marginTop: 40 }}>Social variants</h3>
          {social.x && <SocialBlock label="X thread" body={social.x} />}
          {social.linkedin && <SocialBlock label="LinkedIn" body={social.linkedin} />}
          {social.instagram && <SocialBlock label="Instagram" body={social.instagram} />}
        </>
      )}

      {p.meta_title && !['review', 'scheduled', 'published'].includes(p.status) && (
        <div style={{ marginTop: 32, padding: 16, background: 'var(--paper)', borderRadius: 10, fontSize: 14 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--clay)' }}>SEO META</div>
          <div style={{ marginTop: 6 }}><b>Title:</b> {p.meta_title}</div>
          <div style={{ marginTop: 4, color: 'var(--clay)' }}>{p.meta_description}</div>
        </div>
      )}
    </>
  );
}

function ScheduleLine({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 14, color: 'var(--ink)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    queued: { cls: 'queue', label: 'QUEUED' },
    researching: { cls: 'queue', label: 'RESEARCHING' },
    writing: { cls: 'writing', label: 'WRITING' },
    review: { cls: 'writing', label: 'REVIEW' },
    scheduled: { cls: 'writing', label: 'SCHEDULED' },
    published: { cls: 'live', label: 'LIVE' },
    failed: { cls: 'queue', label: 'FAILED' },
  };
  const b = map[status] ?? map.queued;
  return <span className={`badge ${b.cls}`}><span className="d" />{b.label}</span>;
}

function SocialBlock({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 14, padding: 20, background: 'white', border: '1px solid var(--line)', borderRadius: 12 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--moss)', marginBottom: 8 }}>{label.toUpperCase()}</div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, margin: 0, lineHeight: 1.55 }}>{body}</pre>
    </div>
  );
}
