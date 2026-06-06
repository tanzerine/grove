/**
 * POST /api/track — public analytics ingest.
 *
 * Accepts JSON or sendBeacon Blob payloads. CORS-open so blog pages on
 * customer subdomains can post to it. Bot UAs are silently dropped server-side.
 *
 * The body is one of:
 *   - single event object
 *   - { events: [ ... ] } batch (used by exit beacon)
 */
import { NextResponse } from 'next/server';
import { ingestEvent, type IngestEvent } from '@/lib/analytics/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false }, { status: 400, headers: CORS }); }

  const events: IngestEvent[] = Array.isArray(body?.events)
    ? body.events
    : Array.isArray(body) ? body : [body];

  if (!events.length || events.length > 20) {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || undefined;
  const ua = req.headers.get('user-agent') ?? undefined;
  const country = req.headers.get('x-vercel-ip-country') ?? undefined;

  // Fire-and-forget on best effort. A failed event is never a fatal error
  // for the public page — the user already navigated away.
  await Promise.all(events.map((ev) => ingestEvent(ev, { ip, ua, country })));

  return NextResponse.json({ ok: true }, { headers: CORS });
}
