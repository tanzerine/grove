/**
 * Resolving an MCP bearer token to what it may do.
 *
 * The endpoint is public and unauthenticated until this file says otherwise, so
 * it is the whole security boundary for the feature: every handler downstream
 * trusts the McpContext it is handed and never re-checks ownership.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashKey, isUsable, looksLikeKey, normalizeScopes, type Scope } from './keys';
import { appBase } from '@/lib/seo';
import { mcpResourceUri } from './oauth-metadata';
import { looksLikeAccessToken, normalizeResource, toKeyScopes } from './oauth';

export type McpContext = {
  /** Row id in whichever table the credential came from — see `kind`. */
  keyId: string;
  /**
   * Which credential authenticated this call.
   *
   * The two are otherwise indistinguishable downstream, and that is the design:
   * every handler reads userId/domainId/scopes and never asks how the caller
   * proved who they are. This field exists only so the usage trail writes to
   * the right table.
   */
  kind: 'key' | 'oauth';
  userId: string;
  /**
   * The sites this credential may reach. NULL = every site the user owns.
   *
   * One concept for both credential types: a pinned key resolves to a list of
   * one, an OAuth grant to whatever the customer ticked on the consent screen.
   * Never an empty array — a credential that can see nothing would authenticate
   * and then fail every call, which is worse than being refused outright.
   */
  domainIds: string[] | null;
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
  // Routing on the prefix means a junk header costs no query, and it means the
  // two credential types can never be confused for one another by a lookup that
  // happens to miss in one table and hit in the other.
  if (looksLikeAccessToken(secret)) return authenticateOAuth(secret);
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
      kind: 'key',
      userId: data.user_id,
      domainIds: data.domain_id ? [data.domain_id] : null,
      scopes: normalizeScopes(data.scopes),
      name: data.name ?? 'Content layer',
    },
  };
}

/**
 * The OAuth path. Same shape of answer as a key, deliberately.
 *
 * `domain_ids` is whatever the customer ticked on the consent screen, and NULL
 * for a grant made before per-site consent existed (0040) — which means every
 * site, the same convention a key uses.
 */
async function authenticateOAuth(token: string): Promise<AuthResult> {
  let data: any = null;
  try {
    const res = await supabaseAdmin()
      .from('oauth_tokens')
      .select('id,user_id,client_id,scopes,resource,domain_ids,revoked_at,expires_at')
      .eq('token_hash', hashKey(token))
      .maybeSingle();
    if (res.error) return { ok: false, reason: 'unavailable' };
    data = res.data;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (!data) return { ok: false, reason: 'unknown' };
  if (data.revoked_at) return { ok: false, reason: 'inactive' };
  if (new Date(data.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'inactive' };

  // RFC 8707 audience binding, and the reason a token minted against a preview
  // deployment cannot be replayed against production. The 401 message already
  // says "or belong to another environment", which is exactly this case.
  if (normalizeResource(data.resource ?? '') !== normalizeResource(mcpResourceUri(appBase()))) {
    return { ok: false, reason: 'inactive' };
  }

  return {
    ok: true,
    ctx: {
      keyId: data.id,
      kind: 'oauth',
      userId: data.user_id,
      // An empty array is normalised to null rather than trusted: it would
      // otherwise scope every query to nothing and read as "this account has no
      // sites", which is a confusing way to express a grant that should not
      // exist in the first place.
      domainIds: data.domain_ids?.length ? data.domain_ids : null,
      scopes: toKeyScopes(data.scopes ?? []),
      name: 'Connected agent',
    },
  };
}

/**
 * Usage trail, best effort. `calls` is incremented from the value we just read
 * rather than in SQL, so two concurrent calls can lose one tick — it drives a
 * dashboard line ("42 calls, last used 3 minutes ago"), not billing, and a
 * counter is not worth an RPC and a round trip on every request.
 */
export async function touchKey(ctx: Pick<McpContext, 'keyId' | 'kind'>, tool: string | null): Promise<void> {
  const table = ctx.kind === 'oauth' ? 'oauth_tokens' : 'mcp_keys';
  const keyId = ctx.keyId;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb.from(table).select('calls').eq('id', keyId).maybeSingle();
    await sb
      .from(table)
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
