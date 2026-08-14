/**
 * Owner-facing management of MCP API keys: list what exists, mint a new one.
 *
 * Session-authenticated (this is the dashboard talking, not an agent). The
 * MCP server itself is at /api/mcp and authenticates with the keys minted
 * here — the two never share a code path.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mintKey } from '@/lib/mcp/keys';
import { captureServer } from '@/lib/analytics/capture-server';

/** Live keys per domain. Not a scarcity limit — it's so "revoke the one on the
 *  old laptop" stays a decision a person can make by looking at a short list. */
const MAX_LIVE_KEYS = 5;

const createSchema = z.object({
  domain_id: z.string().uuid(),
  name: z.string().trim().min(1).max(60).optional(),
});

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domainId = new URL(req.url).searchParams.get('domain_id');
  if (!domainId) return NextResponse.json({ error: 'domain_id required' }, { status: 400 });

  // RLS scopes this to the caller's own keys, so a forged domain_id returns an
  // empty list rather than someone else's.
  const { data } = await sb
    .from('mcp_keys')
    .select('id,name,token_prefix,last_used_at,revoked_at,created_at')
    .eq('domain_id', domainId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { domain_id, name } = parsed.data;

  // Ownership is checked explicitly rather than left to RLS: the insert below
  // runs as service-role (there is no INSERT policy on mcp_keys, by design —
  // a client that could write token_hash could mint a key for any domain), so
  // this is the only thing standing between a domain_id in a request body and
  // a working key for it.
  const { data: domain } = await sb
    .from('domains')
    .select('id,hostname')
    .eq('id', domain_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { count } = await sb
    .from('mcp_keys')
    .select('id', { count: 'exact', head: true })
    .eq('domain_id', domain_id)
    .is('revoked_at', null);

  if ((count ?? 0) >= MAX_LIVE_KEYS) {
    return NextResponse.json(
      { error: 'too_many_keys', message: `This site already has ${MAX_LIVE_KEYS} live keys. Revoke one you no longer recognise before creating another.` },
      { status: 409 },
    );
  }

  const minted = mintKey();
  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from('mcp_keys')
    .insert({
      domain_id,
      user_id: user.id,
      name: name || 'Content layer',
      token_hash: minted.token_hash,
      token_prefix: minted.token_prefix,
    })
    .select('id,name,token_prefix,created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await captureServer(user.id, 'mcp_key_created', {});

  // The only time the token is ever readable. Everything else — this API, the
  // dashboard, the database — has the hash and the prefix.
  return NextResponse.json({ key: row, token: minted.token }, { status: 201 });
}
