/**
 * MCP key management for the signed-in owner.
 *
 * Reads and writes go through the SERVICE-ROLE client even though the caller is
 * authenticated as a user: mcp_keys has RLS with no policy on purpose (0035),
 * so a credential digest is unreachable with a user key. Every query here is
 * therefore scoped by hand to `user.id` — that scoping is the access control.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { keyState, mintKey, normalizeScopes } from '@/lib/mcp/keys';

export const dynamic = 'force-dynamic';

/** Never includes key_hash — the digest stays server-side. */
const LIST_COLUMNS = 'id,name,key_prefix,domain_id,scopes,created_at,last_used_at,last_tool,calls,revoked_at,expires_at';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  /** Pin the key to one site. Omitted = every site the account owns. */
  domain_id: z.string().uuid().nullish(),
  /** 'read' is always granted; 'write' additionally allows the two write tools. */
  scopes: z.array(z.enum(['read', 'write'])).optional(),
  expires_in_days: z.number().int().min(1).max(3650).nullish(),
});

export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await supabaseAdmin()
    .from('mcp_keys')
    .select(LIST_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({
    keys: (data ?? []).map((k: any) => ({ ...k, state: keyState(k) })),
  });
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = createSchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const admin = supabaseAdmin();

  // A pinned domain must be one of the caller's own — checked through the
  // user's own RLS-scoped client, so a forged id can't widen the key's reach.
  if (parsed.data.domain_id) {
    const { data: owned } = await sb.from('domains').select('id').eq('id', parsed.data.domain_id).maybeSingle();
    if (!owned) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // A key per site plus a couple of spares is a normal setup; hundreds is a
  // runaway script. Revoked rows don't count — they're history, not access.
  const { count } = await admin
    .from('mcp_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null);
  if ((count ?? 0) >= 20) {
    return NextResponse.json({ error: 'Too many active keys — revoke one first.' }, { status: 400 });
  }

  const minted = mintKey();
  const expiresAt = parsed.data.expires_in_days
    ? new Date(Date.now() + parsed.data.expires_in_days * 86400_000).toISOString()
    : null;

  const { data, error } = await admin.from('mcp_keys').insert({
    user_id: user.id,
    domain_id: parsed.data.domain_id ?? null,
    name: parsed.data.name || 'Content layer',
    key_prefix: minted.prefix,
    key_hash: minted.hash,
    scopes: normalizeScopes(parsed.data.scopes ?? ['read', 'write']),
    expires_at: expiresAt,
  }).select(LIST_COLUMNS).single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // The one and only time the secret exists outside the customer's machine.
  return NextResponse.json({ key: { ...data, state: keyState(data as any) }, secret: minted.secret });
}
