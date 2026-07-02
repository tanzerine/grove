/**
 * POST /api/domains/[id]/interview
 *
 * Saves owner interview answers and, if no active strategy exists for the
 * current month, immediately runs `buildStrategy` so the dashboard isn't
 * empty when the owner lands on /dashboard/strategy.
 *
 * Idempotent: re-saving updates the row + replaces the active strategy for
 * this month (the system trusts the latest owner intent).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildStrategy } from '@/lib/strategy/build';
import { parseInterview } from '@/lib/strategy/interview';
import { savePlanContext } from '@/lib/strategy/context-store';
import { profileSite, type SiteProfile } from '@/lib/pipeline/site-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const body = z.object({
  answers: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  skip: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  // ownership check + load profile in one shot
  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, posts_per_week, site_profile')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const answers = parsed.data.skip ? null : parsed.data.answers;
  const { error: updErr } = await sb
    .from('domains')
    .update({ interview: answers })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  // Auto-trigger first strategy build (best-effort; failure doesn't block save).
  let strategyBuilt = false;
  try {
    const admin = supabaseAdmin();
    let profile = (domain as any).site_profile as SiteProfile | null;

    // The profile is crawled fire-and-forget after verification, so on a fresh
    // signup it's usually NOT ready yet by the time the owner finishes the
    // interview. Build it synchronously here so the very first strategy is
    // always generated — the owner should land on /dashboard/strategy with a
    // real plan, not an empty page. (Ongoing rebuilds happen only on the 1st,
    // via the monthly-strategy cron.)
    if (!profile?.business?.name) {
      try {
        const built = await profileSite((domain as any).hostname);
        if (built?.business?.name) {
          profile = built;
          await admin.from('domains').update({ site_profile: built }).eq('id', id);
        }
      } catch (e) {
        console.error('[interview] profileSite failed:', e);
      }
    }

    if (profile?.business?.name) {
      const now = new Date();
      const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthLabel = thisMonth.toISOString().slice(0, 7);

      const strategy = await buildStrategy({
        month: monthLabel,
        postsPerWeek: (domain as any).posts_per_week ?? 4,
        profile,
        interview: parseInterview(answers),
        prevStrategy: null,
        prevReport: null,
      });

      // Replace active strategy for this month
      await admin.from('strategies').update({ active: false })
        .eq('domain_id', id).eq('active', true);
      await admin.from('strategies').insert({
        domain_id: id,
        month: thisMonth.toISOString().slice(0, 10),
        source: strategy.source,
        goals: strategy.goals,
        kpis: strategy.kpis,
        pillars: strategy.pillars,
        publishing_plan: strategy.publishing_plan,
        direction: strategy.direction ?? null,
        interview: answers,
        notes: strategy.notes,
        active: true,
      });
      await savePlanContext(id, strategy, (domain as any).hostname);
      strategyBuilt = true;
    }
  } catch (err) {
    console.error('[interview] strategy build failed:', err);
    // We still return ok — the owner's answers are saved.
  }

  return NextResponse.json({ ok: true, strategy_built: strategyBuilt });
}
