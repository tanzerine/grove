import GroveMark from '@/components/GroveMark';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isAdminEmail } from '@/lib/admin';
import { ACTIVE_DOMAIN_COOKIE } from '@/lib/active-domain';
import { getOnboarding, EMPTY_ONBOARDING } from '@/lib/onboarding/checklist';
import DashShell from './DashShell';
import type { Chrome } from './chrome-context';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: domains } = await sb.from('domains').select('id,hostname,verified_at').order('created_at');
  if ((domains?.length ?? 0) === 0) redirect('/onboarding/domain');

  // Resolve the active site (cookie pick → first verified → first).
  const jar = await cookies();
  const wanted = jar.get(ACTIVE_DOMAIN_COOKIE)?.value;
  const verified = domains?.find((d) => d.verified_at);
  const active = (wanted && domains?.find((d) => d.id === wanted)) || verified || domains?.[0] || null;

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

  // Real plan label for the sidebar chip (best-effort; never blocks render).
  let plan = 'Free';
  try {
    const { data: sub } = await sb
      .from('subscriptions').select('plan, stripe_status').eq('user_id', user.id).maybeSingle();
    const isActive = sub?.stripe_status && ['active', 'trialing', 'past_due'].includes(sub.stripe_status);
    if (isActive && sub?.plan) plan = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1);
  } catch { /* chip is cosmetic */ }

  // Onboarding "what to do next" progress for the header bell (best-effort).
  let onboarding = EMPTY_ONBOARDING;
  try { onboarding = await getOnboarding(sb, active); } catch { /* guide is optional */ }

  const chrome: Chrome = {
    email: user.email ?? null,
    isAdmin: isAdminEmail(user.email),
    plan,
    activeHostname: active?.hostname ?? null,
    domains: (domains ?? []).map((d) => ({ id: d.id, hostname: d.hostname, verified_at: d.verified_at })),
    activeId: active?.id ?? null,
    onboarding,
  };

  return (
    <>
      <GroveMark />
      <DashShell chrome={chrome} badges={badges}>
        {children}
      </DashShell>
    </>
  );
}
