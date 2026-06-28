import GroveMark from '@/components/GroveMark';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashShell from './DashShell';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: domains } = await sb.from('domains').select('id,hostname,verified_at').order('created_at');
  const verified = domains?.find((d) => d.verified_at);
  if (!verified && (domains?.length ?? 0) === 0) redirect('/onboarding/domain');

  // Nav badges — small, best-effort counts (never block render on failure).
  const badges: Record<string, number> = {};
  try {
    const domainIds = (domains ?? []).map((d) => d.id);
    if (domainIds.length) {
      const { data: posts } = await sb
        .from('posts').select('status,domain_id').in('domain_id', domainIds);
      const inPipeline = (posts ?? []).filter((p) =>
        !['published', 'failed', 'archived'].includes((p as any).status)).length;
      const inReview = (posts ?? []).filter((p) =>
        ['review', 'needs_review', 'awaiting_review'].includes((p as any).status)).length;
      if (inPipeline) badges.pipeline = inPipeline;
      if (inReview) badges.reviews = inReview;
    }
  } catch { /* badges are optional */ }

  const acct = verified
    ? { name: verified.hostname, sub: 'verified · autopilot on' }
    : domains?.[0]
      ? { name: domains[0].hostname, sub: 'setup in progress' }
      : null;

  // Real plan label for the sidebar chip (best-effort; never blocks render).
  let plan = 'Free';
  try {
    const { data: sub } = await sb
      .from('subscriptions').select('plan, stripe_status').eq('user_id', user.id).maybeSingle();
    const active = sub?.stripe_status && ['active', 'trialing', 'past_due'].includes(sub.stripe_status);
    if (active && sub?.plan) plan = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1);
  } catch { /* chip is cosmetic */ }

  return (
    <>
      <GroveMark />
      <DashShell
        verified={verified ? { hostname: verified.hostname } : null}
        account={acct}
        badges={badges}
        plan={plan}
      >
        {children}
      </DashShell>
    </>
  );
}
