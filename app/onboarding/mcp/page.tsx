/**
 * /onboarding/mcp — the optional developer step, shown once, right after the
 * domain is verified.
 *
 * WHY HERE. The customer has just been asked to touch their DNS or their
 * homepage `<head>`, so at this exact moment we know two things about them
 * that are true nowhere else in the product: they have a repo, and they have
 * it open. That is the only moment "connect your coding agent" costs them
 * nothing. Discovered a week later from a dashboard nav item, the same
 * integration means re-opening a repo they'd closed — which is why customers
 * with a real content layer were defaulting to the embed and never coming
 * back to it.
 *
 * It is an OFFER, not a step: skipping is one click, it never blocks the
 * dashboard, and /dashboard/mcp remains the full surface (multiple keys,
 * per-site scoping, delivery state). This page mints one key with the sane
 * defaults and hands over one command.
 */
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { appBase } from '@/lib/seo';
import GroveMark from '@/components/GroveMark';
import StepView from '../StepView';
import McpStep from './McpStep';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const { domain } = await searchParams;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  // Best-effort, and RLS-scoped: the hostname is only used to address the
  // customer by the site they just verified. A missing row (a hand-typed URL,
  // someone else's id) costs the greeting, not the step.
  let hostname: string | null = null;
  if (domain) {
    const { data } = await sb.from('domains').select('hostname').eq('id', domain).maybeSingle();
    hostname = data?.hostname ?? null;
  }

  return (
    <main className="gv-onb">
      <StepView step="mcp" />
      <GroveMark />
      <div className="gv-auth-glow" aria-hidden><span className="b1" /><span className="b2" /></div>
      <div className="gv-onb-in" style={{ maxWidth: 780 }}>
        <McpStep endpoint={`${appBase()}/api/mcp`} hostname={hostname} />
      </div>
    </main>
  );
}
