import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { planProgrammaticSet } from '@/lib/pseo';
import type { SiteProfile } from '@/lib/pipeline/site-profile';
import { enforceEntitlement } from '@/lib/billing';
import { languageForDomain } from '@/lib/language';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({
  domain_id: z.string().uuid(),
  seed: z.string().min(2).max(80),
  count: z.number().int().min(1).max(12).optional(),
});

// Preview a programmatic set before committing to generation. Read-only.
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  const blocked = await enforceEntitlement(user.id, 'pseo_plan', sb);
  if (blocked) return blocked;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb
    .from('domains').select('id, site_profile, language').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const profile = (domain as any).site_profile as SiteProfile | null;
  if (!profile?.business?.name) {
    return NextResponse.json({ error: 'no_profile' }, { status: 409 });
  }

  const plan = await planProgrammaticSet(profile, parsed.data.seed, parsed.data.count ?? 6, languageForDomain(domain).code);
  return NextResponse.json(plan);
}
