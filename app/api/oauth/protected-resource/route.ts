/**
 * The RFC 9728 protected-resource metadata document.
 *
 * Reached at `/.well-known/oauth-protected-resource` and at the RFC's
 * path-inserted form `/.well-known/oauth-protected-resource/api/mcp`, both
 * rewritten here in next.config.mjs — a literal `app/.well-known/` directory is
 * not a shape the App Router's file scanner is reliable about, and a rewrite is
 * explicit either way.
 *
 * Unauthenticated and CORS-open on purpose: this document is how a client that
 * has NO credentials discovers where to get some, so requiring credentials to
 * read it would be circular. It contains nothing private.
 *
 * Every URL inside comes from `appBase()`, never from the request's Host — see
 * the note in lib/mcp/oauth-metadata.ts about customer-controlled hostnames.
 */
import { NextResponse } from 'next/server';
import { appBase } from '@/lib/seo';
import { protectedResourceMetadata } from '@/lib/mcp/oauth-metadata';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  // Discovery runs on every cold client start. An hour is long enough to stop
  // it being chatty and short enough that the authorization server can move.
  'cache-control': 'public, max-age=3600',
};

export function GET() {
  return NextResponse.json(protectedResourceMetadata(appBase()), { headers: HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
