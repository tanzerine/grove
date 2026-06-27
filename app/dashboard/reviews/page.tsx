import { supabaseServer } from '@/lib/supabase/server';
import ReviewsTable from './ReviewsTable';
import { HeaderRight } from '../gv-chrome';

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
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Reviews</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>the manager scored it — every gate decision, in one place</div>
        </div>
        <HeaderRight />
      </header>
      <div className="gv-body">
        <p style={{ fontSize: 14, color: '#9aa096', margin: '0 0 4px', maxWidth: 640 }}>
          Every gate decision the manager agent made — approve, rewrite, or reject — with the issues it flagged.
          Click a row to see the full rubric and rewrite brief.
        </p>
        <ReviewsTable rows={rows as any} />
      </div>
    </>
  );
}

function Empty() {
  return (
    <>
      <header className="gv-header"><div style={{ fontSize: 16, fontWeight: 700 }}>Reviews</div></header>
      <div className="gv-body"><p style={{ color: '#9aa096' }}>Connect a domain first.</p></div>
    </>
  );
}
