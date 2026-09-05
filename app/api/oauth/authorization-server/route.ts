/**
 * RFC 8414 authorization server metadata — the document that closes the
 * discovery chain the 401 challenge opens.
 *
 * Reached at `/.well-known/oauth-authorization-server` (rewritten in
 * next.config.mjs). Unauthenticated and CORS-open for the same reason as the
 * protected-resource document: a client with no credentials reads this to find
 * out how to get some.
 */
import { NextResponse } from 'next/server';
import { appBase } from '@/lib/seo';
import { authorizationServerMetadata } from '@/lib/mcp/oauth-metadata';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'public, max-age=3600',
};

export function GET() {
  return NextResponse.json(authorizationServerMetadata(appBase()), { headers: HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
