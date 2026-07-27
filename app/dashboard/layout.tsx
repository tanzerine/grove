import GroveMark from '@/components/GroveMark';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isAdminEmail } from '@/lib/admin';
import { entitlementFrom } from '@/lib/billing';
import { ACTIVE_DOMAIN_COOKIE } from '@/lib/active-domain';
import { getOnboarding, EMPTY_ONBOARDING } from '@/lib/onboarding/checklist';
import { getActivity, EMPTY_ACTIVITY } from '@/lib/notifications/feed';
import { pipelineCounts } from '@/lib/pipeline/counts';
import DashShell from './DashShell';
import ActivityPing from './ActivityPing';
import type { Chrome } from './chrome-context';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: domains } = await sb.from('domains').select('id,hostname,verified_at,auto_publish').order('created_at');
  // New users have no domain yet — start onboarding at the "about you" step,
  // which forwards to the domain step (and skips itself for anyone who already
  // answered it). Returning users with a domain never reach this line.
  if ((domains?.length ?? 0) === 0) redirect('/onboarding/about');

  // Resolve the active site (cookie pick → first verified → first).
  const jar = await cookies();
  const wanted = jar.get(ACTIVE_DOMAIN_COOKIE)?.value;
  const verified = domains?.find((d) => d.verified_at);
  const active = (wanted && domains?.find((d) => d.id === wanted)) || verified || domains?.[0] || null;

  // Nav badge — best-effort (never block render on failure).
  //
  // Scoped to the ACTIVE site and counting only what needs the owner
  // personally. It used to sum every non-terminal post across every domain
  // they own, so an account with one site holding 1 draft for review and
  // another holding 15 queued saw "16" in the nav while the pipeline page for
  // the site they were actually looking at said "1 waiting on you".
  //
  // Queued and scheduled posts are the agent working, not a to-do; they belong
  // in the pipeline view, not in an alarm. lib/pipeline/counts is the single
  // definition every surface now shares.
  const badges: Record<string, number> = {};
  try {
    if (active?.id) {
      const { data: posts } = await sb
        .from('posts').select('status,created_at').eq('domain_id', active.id);
      const { needsYou } = pipelineCounts(posts ?? []);
      if (needsYou) badges.pipeline = needsYou;
    }
  } catch { /* badges are optional */ }

  // Real plan label for the sidebar chip + entitlement (best-effort; never
  // blocks render). `entitled` gates every cost-bearing action in the UI and
  // is the single source the client reads to decide "run it" vs "tease it";
  // the backend 402s independently, so a wrong-but-generous value can't leak
  // LLM spend. entitlementFrom() is the same pure rule the APIs use.
  let plan = 'Free';
  let entitled = false;
  try {
    const { data: sub } = await sb
      // `*` so entitlementFrom sees `comped` (0030) — a comped account must
      // not have its cost-bearing UI actions greyed out.
      .from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
    const isActive = sub?.stripe_status && ['active', 'trialing', 'past_due'].includes(sub.stripe_status);
    if (isActive && sub?.plan) plan = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1);
    entitled = entitlementFrom(sub).canGenerate;
  } catch { /* chip is cosmetic; stay un-entitled on error */ }

  // Header bell payloads (best-effort) — onboarding guide + live activity feed.
  let onboarding = EMPTY_ONBOARDING;
  let activity = EMPTY_ACTIVITY;
  try { onboarding = await getOnboarding(sb, active); } catch { /* guide is optional */ }
  try { activity = await getActivity(sb, active); } catch { /* feed is optional */ }

  const chrome: Chrome = {
    email: user.email ?? null,
    isAdmin: isAdminEmail(user.email),
    plan,
    entitled,
    activeHostname: active?.hostname ?? null,
    activeId: active?.id ?? null,
    activeAutoPublish: !!(active as any)?.auto_publish,
    domains: (domains ?? []).map((d) => ({ id: d.id, hostname: d.hostname, verified_at: d.verified_at })),
    onboarding,
    activity,
  };

  return (
    <>
      <GroveMark />
      <ActivityPing />
      <DashShell chrome={chrome} badges={badges}>
        {children}
      </DashShell>
    </>
  );
}
