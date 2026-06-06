import { supabaseServer } from '@/lib/supabase/server';
import ReviewsTable from './ReviewsTable';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: domain } = await sb
    .from('domains')
    .select('id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!domain) return <Empty />;

  const { data: evaluations = [] } = await sb
    .from('post_evaluations')
    .select('id,post_id,attempt,action,pass,scores,issues,rewrite_brief,created_at, posts(title,slug,status)')
    .order('created_at', { ascending: false })
    .limit(100);

  // Only this domain's posts (join filters via RLS, but be defensive)
  const rows = (evaluations ?? []).filter((r: any) => r.posts);

  return (
    <>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>MANAGER REVIEWS</div>
      <h2 className="display" style={{ fontSize: 32, marginTop: 6 }}>What the editor decided</h2>
      <p style={{ fontSize: 14, color: 'var(--clay)', marginTop: 8 }}>
        Every gate decision the manager agent made — approve, rewrite, or reject — with the issues it flagged.
      </p>
      <ReviewsTable rows={rows as any} />
    </>
  );
}

function Empty() {
  return <p style={{ color: 'var(--clay)' }}>Connect a domain first.</p>;
}
