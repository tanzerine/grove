/**
 * Resolving an MCP bearer token to what it may do.
 *
 * The endpoint is public and unauthenticated until this file says otherwise, so
 * it is the whole security boundary for the feature: every handler downstream
 * trusts the McpContext it is handed and never re-checks ownership.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashKey, isUsable, looksLikeKey, normalizeScopes, type Scope } from './keys';

export type McpContext = {
  keyId: string;
  userId: string;
  /** Non-null when the key is pinned to one site; null = every site the user owns. */
  domainId: string | null;
  scopes: Scope[];
  name: string;
};

export type AuthFailure = 'missing' | 'malformed' | 'unknown' | 'inactive' | 'unavailable';

export type AuthResult =
  | { ok: true; ctx: McpContext }
  | { ok: false; reason: AuthFailure };

/**
 * Look the key up by digest. The shape check first means a junk header costs no
 * query, and the lookup is a unique-index hit on the hash — a stolen database
 * dump contains no replayable credential.
 */
export async function authenticate(secret: string | null): Promise<AuthResult> {
  if (!secret) return { ok: false, reason: 'missing' };
  if (!looksLikeKey(secret)) return { ok: false, reason: 'malformed' };

  // A database that is down must not read as a bad key: the customer's agent
  // would stop and tell them to make a new one, which fixes nothing and loses
  // the working credential. Report it as unavailable and let the caller say so.
  let data: any = null;
  try {
    const res = await supabaseAdmin()
      .from('mcp_keys')
      .select('id,user_id,domain_id,name,scopes,revoked_at,expires_at')
      .eq('key_hash', hashKey(secret))
      .maybeSingle();
    if (res.error) return { ok: false, reason: 'unavailable' };
    data = res.data;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (!data) return { ok: false, reason: 'unknown' };
  // Revoked and expired are deliberately reported the same way to the caller:
  // the difference is the customer's business, and the API telling an attacker
  // "this key existed and was revoked" is information it doesn't need to give.
  if (!isUsable(data)) return { ok: false, reason: 'inactive' };

  return {
    ok: true,
    ctx: {
      keyId: data.id,
      userId: data.user_id,
      domainId: data.domain_id ?? null,
      scopes: normalizeScopes(data.scopes),
      name: data.name ?? 'Content layer',
    },
  };
}

/**
 * Usage trail, best effort. `calls` is incremented from the value we just read
 * rather than in SQL, so two concurrent calls can lose one tick — it drives a
 * dashboard line ("42 calls, last used 3 minutes ago"), not billing, and a
 * counter is not worth an RPC and a round trip on every request.
 */
export async function touchKey(keyId: string, tool: string | null): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb.from('mcp_keys').select('calls').eq('id', keyId).maybeSingle();
    await sb
      .from('mcp_keys')
      .update({
        last_used_at: new Date().toISOString(),
        ...(tool ? { last_tool: tool } : {}),
        calls: (data?.calls ?? 0) + 1,
      })
      .eq('id', keyId);
  } catch {
    // Never fail a customer's sync because the usage counter didn't write.
  }
}
