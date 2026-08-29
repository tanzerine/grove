/**
 * DELETE /api/mcp/keys/[id] — revoke one MCP key.
 *
 * Revoked, not deleted: mcp_deliveries points at the key that reported each
 * article, and that record is the customer's evidence that their content is
 * live. Killing the row would take the audit trail with it.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // `.eq('user_id', …)` is the ownership check: the service-role client bypasses
  // RLS, so without it any signed-in account could revoke anyone's key.
  const { data, error } = await supabaseAdmin()
    .from('mcp_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Already revoked or not theirs — same answer either way, so this can't be
  // used to probe which key ids exist.
  if (!data) return NextResponse.json({ ok: true, revoked: false });

  return NextResponse.json({ ok: true, revoked: true });
}
