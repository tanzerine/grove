import { supabaseServer } from '@/lib/supabase/server';
import PipelineActions from './PipelineActions';
import PostRow from './PostRow';
import ModeToggle from './ModeToggle';

export default async function Page() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];
  const { data: posts } = await sb
    .from('posts').select('*').eq('domain_id', domain?.id).order('created_at', { ascending: false }).limit(20);

  // Latest manager evaluation per post → show the quality score in the pipeline.
  const ids = (posts ?? []).map((p) => p.id);
  const scoreByPost = new Map<string, { overall: number; action: string }>();
  if (ids.length) {
    const { data: evals } = await sb
      .from('post_evaluations')
      .select('post_id, scores, action, created_at')
      .in('post_id', ids)
      .order('created_at', { ascending: false });
    for (const e of evals ?? []) {
      if (!scoreByPost.has((e as any).post_id)) {
        scoreByPost.set((e as any).post_id, { overall: (e as any).scores?.overall ?? 0, action: (e as any).action });
      }
    }
  }

  return (
    <>
      <div className="dm-top">
        <h4 style={{ fontFamily: 'Clash Display', fontSize: 28, margin: 0 }}>Content pipeline</h4>
      </div>

      {domain && (
        <ModeToggle
          domainId={domain.id}
          autoPublish={domain.auto_publish ?? false}
          postsPerWeek={domain.posts_per_week ?? 2}
        />
      )}

      <PipelineActions domainId={domain?.id} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
        {(posts ?? []).map((p) => <PostRow key={p.id} p={p} score={scoreByPost.get(p.id) ?? null} />)}
        {(!posts || posts.length === 0) && (
          <p className="lede">No posts yet. Queue a topic above — the pipeline runs immediately.</p>
        )}
      </div>
    </>
  );
}
