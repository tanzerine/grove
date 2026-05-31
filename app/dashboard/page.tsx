import { supabaseServer } from '@/lib/supabase/server';
import PipelineActions from './PipelineActions';

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  queued: { cls: 'queue', label: 'QUEUED' },
  researching: { cls: 'queue', label: 'RESEARCHING' },
  writing: { cls: 'writing', label: 'WRITING' },
  review: { cls: 'writing', label: 'REVIEW' },
  scheduled: { cls: 'writing', label: 'SCHEDULED' },
  published: { cls: 'live', label: 'LIVE' },
  failed: { cls: 'queue', label: 'FAILED' },
};

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const { data: posts } = await sb
    .from('posts').select('*').eq('domain_id', domain?.id).order('created_at', { ascending: false }).limit(20);

  return (
    <>
      <div className="dm-top">
        <h4 style={{ fontFamily: 'Clash Display', fontSize: 28, margin: 0 }}>Content pipeline</h4>
        <span className="meta">{domain?.posts_per_week} posts / week · {domain?.auto_publish ? 'auto-publish on' : 'review queue on'}</span>
      </div>
      <PipelineActions domainId={domain?.id} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
        {(posts ?? []).map((p) => {
          const b = STATUS_BADGE[p.status] ?? STATUS_BADGE.queued;
          return (
            <div className="post-row" key={p.id}>
              <div className="pthumb" />
              <div className="pbody">
                <div className="ptitle">{p.title ?? p.topic ?? '(no title yet)'}</div>
                <div className="pmeta">
                  {p.status === 'published' ? `Published · ${p.reads} reads` :
                   p.status === 'review' ? `${p.validation?.stats?.word_count ?? '—'} words · awaiting your review` :
                   p.status === 'writing' ? 'Drafting…' :
                   p.status === 'researching' ? 'Gathering sources…' :
                   p.topic}
                </div>
              </div>
              <span className={`badge ${b.cls}`}><span className="d" />{b.label}</span>
            </div>
          );
        })}
        {(!posts || posts.length === 0) && (
          <p className="lede">No posts yet. The first draft will appear here shortly after voice profiling completes.</p>
        )}
      </div>
    </>
  );
}
