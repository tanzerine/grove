import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { verifyDomainOwnership } from '@/lib/verify-domain';
import { kickoffProvisioning } from '@/lib/pipeline/provisioning';

const body = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = body.parse(await req.json());
  const { data: domain, error } = await sb.from('domains').select('*').eq('id', id).eq('user_id', user.id).single();
  if (error || !domain) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (domain.verified_at) return NextResponse.json({ ok: true, already: true });

  const result = await verifyDomainOwnership(domain.hostname, domain.verify_token);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason });

  await sb.from('domains').update({ verified_at: new Date().toISOString() }).eq('id', domain.id);
  await kickoffProvisioning(domain.id);
  return NextResponse.json({ ok: true, via: result.via });
}
