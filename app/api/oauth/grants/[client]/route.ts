/**
 * DELETE /api/oauth/grants/[client] — disconnect one agent.
 *
 * REVOKES THE WHOLE LINEAGE, not just the live token. Refresh rotation means a
 * client can hold several rows, and revoking only the newest would leave any
 * refresh token the agent still has on disk able to mint a fresh pair — the
 * customer would press Disconnect, see the agent vanish from the list, and it
 * would come back on the next refresh. So every unrevoked row for this client
 * goes at once.
 *
 * Revoked, never deleted: the rows are the record of what had access and when.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // `.eq('user_id', …)` is the ownership check. The service-role client bypasses
  // RLS, so without it any signed-in account could disconnect anyone's agent.
  const { data, error } = await supabaseAdmin()
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', client)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Already disconnected or never theirs — the same answer either way, so this
  // cannot be used to probe which client ids exist on other accounts.
  return NextResponse.json({ ok: true, revoked: data?.length ?? 0 });
}
