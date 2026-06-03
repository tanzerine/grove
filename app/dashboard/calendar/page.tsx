import { supabaseServer } from '@/lib/supabase/server';
import CalendarClient from './CalendarClient';

export default async function CalendarPage() {
  const sb = await supabaseServer();
  const { data: domains } = await sb.from('domains').select('*').limit(1);
  const domain = domains?.[0];

  // Fetch all posts that have a scheduled or published date
  const { data: posts } = await sb
    .from('posts')
    .select('id, title, topic, status, scheduled_at, published_at, slug')
    .eq('domain_id', domain?.id)
    .or('scheduled_at.not.is.null,published_at.not.is.null,status.eq.review')
    .order('scheduled_at', { ascending: true });

  // Also fetch review posts (no date, needs scheduling)
  const { data: reviewPosts } = await sb
    .from('posts')
    .select('id, title, topic, status, scheduled_at, published_at')
    .eq('domain_id', domain?.id)
    .eq('status', 'review')
    .is('scheduled_at', null);

  return (
    <CalendarClient
      domainId={domain?.id}
      posts={posts ?? []}
      unscheduledReview={reviewPosts ?? []}
    />
  );
}
