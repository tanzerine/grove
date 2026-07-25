import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { profileSite } from '@/lib/pipeline/site-profile';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const maxDuration = 120;

const body = z.object({ id: z.string().uuid() });

/**
 * Run the site profiler synchronously for a domain. Returns the resulting
 * profile (or the error). Use this to manually rebuild a stale or missing
 * profile from the dashboard.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`crawl:${user.id}`, LIMITS.crawl);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb.from('domains').select('*').eq('id', parsed.data.id).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Crawling + profiling is an outbound fetch and an LLM call against an
  // attacker-chosen hostname, so proving ownership is the gate that matters —
  // owning the domains *row* only means you typed the name in. Same rule as the
  // interview route; the two are the only on-demand paths into profileSite.
  if (!domain.verified_at) {
    return NextResponse.json(
      { error: 'Verify that you own this domain before crawling it.' },
      { status: 403 },
    );
  }

  try {
    const profile = await profileSite(domain.hostname);
    const admin = supabaseAdmin();
    await admin.from('domains').update({ site_profile: profile }).eq('id', domain.id);
    return NextResponse.json({ ok: true, profile });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message ?? e),
      stack: process.env.NODE_ENV === 'development' ? String(e?.stack ?? '') : undefined,
    }, { status: 500 });
  }
}
