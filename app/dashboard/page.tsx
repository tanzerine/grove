import { supabaseServer } from '@/lib/supabase/server';
import PipelineActions from './PipelineActions';
import PostRow from './PostRow';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const { data: posts } = await sb
    .from('posts').select('*').eq('domain_id', domain?.id).order('created_at', { ascending: false }).limit(20);

  // Note: dashboard auto-refreshes via the PipelineTimeline component on the
  // detail page. The pipeline list itself is a server component; refresh manually
  // (or we can add a similar polling refresher here if needed).

  return (
    <>
      <div className="dm-top">
        <h4 style={{ fontFamily: 'Clash Display', fontSize: 28, margin: 0 }}>Content pipeline</h4>
        <span className="meta">{domain?.posts_per_week} posts / week · {domain?.auto_publish ? 'auto-publish on' : 'review queue on'}</span>
      </div>
      <PipelineActions domainId={domain?.id} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
        {(posts ?? []).map((p) => <PostRow key={p.id} p={p} />)}
        {(!posts || posts.length === 0) && (
          <p className="lede">No posts yet. Queue a topic above — the pipeline runs immediately.</p>
        )}
      </div>
    </>
  );
}
