/**
 * DELETE /api/mcp/keys/[id] — revoke one MCP key.
 *
 * Revocation sets `revoked_at` rather than deleting the row: the question an
 * owner asks after revoking is "what was this key doing, and until when",
 * and a deleted row cannot answer it. /api/mcp refuses any key with a
 * non-null revoked_at, so the effect is immediate either way.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS ("mcp_keys_update_own") scopes the update to the caller's own keys, so
  // someone else's id matches no row and the response is a 404 either way.
  const { data, error } = await sb
    .from('mcp_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
