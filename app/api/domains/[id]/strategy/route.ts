/**
 * POST /api/domains/[id]/strategy
 *
 * Build this month's strategy for one domain, now.
 *
 * The interview already builds a plan the moment the owner answers it, so this
 * is the recovery path: the strategist is one LLM call, and when that call fails
 * (or the account predates the auto-build) the owner would otherwise sit on an
 * empty strategy page until the 1st of next month. The dashboard's empty state
 * calls this so the wait is a button, not a month.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { ensureMonthlyStrategy } from '@/lib/strategy/ensure';
import { profileSite, type SiteProfile } from '@/lib/pipeline/site-profile';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Crawl + strategist call: same ceiling as the other cost-bearing crawl routes.
  const limited = await enforceRateLimit(`strategy:${user.id}`, LIMITS.crawl);
  if (limited) return limited;

  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, posts_per_week, site_profile, interview, verified_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // The hostname is attacker-chosen, and this route crawls it and spends LLM
  // budget on it. Ownership of the Grove account isn't ownership of the site —
  // verification is (see the interview route for the incident this prevents).
  if (!(domain as any).verified_at) {
    return NextResponse.json({ error: 'unverified', message: 'Verify this domain first.' }, { status: 409 });
  }

  let profile = (domain as any).site_profile as SiteProfile | null;
  if (!profile?.business?.name) {
    try {
      const built = await profileSite((domain as any).hostname);
      if (built?.business?.name) {
        profile = built;
        await sb.from('domains').update({ site_profile: built }).eq('id', id);
      }
    } catch (e) {
      console.error('[strategy build] profileSite failed:', e);
    }
  }

  try {
    const result = await ensureMonthlyStrategy(
      {
        id,
        hostname: (domain as any).hostname,
        posts_per_week: (domain as any).posts_per_week ?? null,
        site_profile: profile,
        interview: (domain as any).interview,
        user_id: user.id,
      },
      // A plan the owner is waiting on is worth building from their answers
      // alone; 'exists' is a fine answer, so nothing is replaced here.
      { profileFallback: true },
    );
    return NextResponse.json({ ok: true, result, built: result === 'created' || result === 'exists' });
  } catch (err: any) {
    console.error('[strategy build] failed:', err);
    return NextResponse.json(
      { error: 'build_failed', message: 'The strategist could not finish — try again in a minute.' },
      { status: 502 },
    );
  }
}
