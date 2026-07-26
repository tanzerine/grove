import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { makeBlogSlug, normalizeHost } from '@/lib/verify-domain';
import {
  canAddDomain,
  describeDomainLimit,
  domainLimitFor,
  smallestPlanForDomains,
  PLANS,
} from '@/lib/plans';

const body = z.object({ hostname: z.string().min(3) });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid hostname' }, { status: 400 });

  const hostname = normalizeHost(parsed.data.hostname);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
    return NextResponse.json({ error: 'hostname looks malformed' }, { status: 400 });
  }

  // Plan ceiling. This is the ONLY path that creates a domain row, so it is the
  // only place the check has to live. Best-effort by design: if we can't read
  // the subscription or the domain count we let the insert through rather than
  // block a legitimate customer on a transient read failure — the same
  // fail-open stance lib/quota takes, for the same reason.
  try {
    const [{ data: sub }, { count }] = await Promise.all([
      sb.from('subscriptions')
        .select('plan, stripe_status, stripe_price_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      sb.from('domains')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);

    const limit = domainLimitFor(sub);
    const current = count ?? 0;
    if (!canAddDomain(limit, current)) {
      const upgrade = smallestPlanForDomains(current + 1);
      return NextResponse.json(
        {
          error: `Your plan includes ${describeDomainLimit(limit)}.`,
          reason: 'domain_limit',
          limit,
          current,
          // What to sell them, if anything bigger exists.
          upgradeTo: upgrade,
          upgradeName: upgrade ? PLANS[upgrade].name : null,
        },
        { status: 402 },
      );
    }
  } catch {
    /* couldn't evaluate the ceiling — don't punish the customer for it */
  }

  const { data, error } = await sb
    .from('domains')
    .insert({ user_id: user.id, hostname, blog_slug: makeBlogSlug(hostname) })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const query = sb.from('domains').select('*').eq('user_id', user.id);
  const { data, error } = id ? await query.eq('id', id).single() : await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
