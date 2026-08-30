import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import CalendarClient, { type PlannedSlot } from './CalendarClient';
import type { PostSlot } from '@/lib/strategy/build';
import { DashHeader } from '../gv-chrome';
import { getT } from '@/lib/i18n/server';

export default async function CalendarPage() {
  const t = await getT();
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);

  // Posts that have a date (scheduled/published/in-flight) OR are awaiting review.
  const { data: posts } = await sb
    .from('posts')
    .select('id, title, topic, status, scheduled_at, published_at, slug, slot_id')
    .eq('domain_id', domain?.id)
    .or('scheduled_at.not.is.null,published_at.not.is.null,status.eq.review')
    .order('scheduled_at', { ascending: true });

  // Review posts with no date yet — still need a slot on the calendar.
  const { data: reviewPosts } = await sb
    .from('posts')
    .select('id, title, topic, status, scheduled_at, published_at')
    .eq('domain_id', domain?.id)
    .eq('status', 'review')
    .is('scheduled_at', null);

  // Active strategy's plan → slots not yet turned into posts = "planned".
  const { data: strat } = await sb
    .from('strategies')
    .select('id, publishing_plan')
    .eq('domain_id', domain?.id)
    .eq('active', true)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();

  const materializedSlotIds = new Set((posts ?? []).map((p: any) => p.slot_id).filter(Boolean));
  const plannedSlots: PlannedSlot[] = (((strat as any)?.publishing_plan ?? []) as PostSlot[])
    .filter((s) => s.publish_date && !materializedSlotIds.has(s.id))
    .map((s) => ({
      slot_id: s.id,
      topic: s.topic,
      intent: s.intent,
      publish_date: s.publish_date!,
    }));

  return (
    <>
      <DashHeader title="Calendar" subtitle={t('when each post goes live, and where it is now')} />
      <div className="gv-body">
        <CalendarClient
          domainId={domain?.id}
          posts={posts ?? []}
          unscheduledReview={reviewPosts ?? []}
          plannedSlots={plannedSlots}
        />
      </div>
    </>
  );
}
