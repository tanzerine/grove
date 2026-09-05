/**
 * Dynamic client registration (RFC 7591).
 *
 * OPEN ON PURPOSE, AND IT GRANTS NOTHING. Anyone may register; a registered
 * client can do exactly nothing until a signed-in human approves it on the
 * consent screen. The row created here is a name and a set of redirect URIs,
 * not a permission — treating registration as the security boundary is the
 * mistake this comment exists to prevent someone making later.
 *
 * The spec has since moved on: Client ID Metadata Documents (the client_id is
 * itself an HTTPS URL the server fetches) are the preferred mechanism and DCR
 * is retained for backwards compatibility. Shipped clients still speak DCR, so
 * this is what makes the flow work today.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CLIENT_PREFIX, mintOpaque, redirectUriValid } from '@/lib/mcp/oauth';

export const dynamic = 'force-dynamic';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const schema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: z.string().trim().min(1).max(120).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
});

/** RFC 7591 §3.2.2 error shape — clients parse this, not an HTTP status alone. */
function invalid(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: CORS });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return invalid('invalid_client_metadata', 'Body must be JSON.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return invalid('invalid_client_metadata', 'redirect_uris is required and must be a non-empty array of strings.');
  }

  // Every URI is checked before any is stored. A client that registers one good
  // and one hostile URI would otherwise be able to choose the hostile one at
  // authorize time and carry an authorization code off with it.
  const uris = parsed.data.redirect_uris.map((u) => u.trim());
  const bad = uris.find((u) => !redirectUriValid(u));
  if (bad) {
    return invalid(
      'invalid_redirect_uri',
      `${bad} is not an acceptable redirect URI. Use https, a custom scheme, or http on the loopback interface.`,
    );
  }

  // Public clients only. A CLI cannot keep a secret, so grove issues none and
  // relies on PKCE — saying so plainly here stops a client from waiting for a
  // client_secret that is never coming.
  const method = parsed.data.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') {
    return invalid(
      'invalid_client_metadata',
      'Only public clients are supported (token_endpoint_auth_method must be "none"). PKCE is required instead of a client secret.',
    );
  }

  const clientId = mintOpaque(CLIENT_PREFIX).secret;
  const name = parsed.data.client_name || 'An MCP client';

  const { error } = await supabaseAdmin().from('oauth_clients').insert({
    client_id: clientId,
    client_name: name,
    redirect_uris: uris,
  });
  if (error) {
    return invalid('invalid_client_metadata', 'Could not register this client right now. Retry shortly.', 503);
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // 0 = does not expire (RFC 7591 §3.2.1).
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
    },
    { status: 201, headers: CORS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
