/**
 * Server-side helpers for ingesting analytics events into post_events.
 *
 * Stays minimal on purpose:
 *  - Truncate the IP to /24 (v4) or /48 (v6) and hash with a server salt
 *    before storing. We never persist a usable IP.
 *  - Normalize referrer to its host and extract search query when possible.
 *  - Drop obvious bot traffic.
 */
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase/admin';

const IP_SALT = process.env.IP_SALT ?? 'grove-default-salt';

export type IngestEvent = {
  post_id: string;
  domain_id: string;
  type: 'view' | 'dwell' | 'scroll' | 'outbound' | 'exit' | 'conversion';
  session_id: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  query?: string;
  outbound_url?: string;
  scroll_depth?: number;
  dwell_ms?: number;
};

export type IngestContext = {
  ip?: string;
  ua?: string;
  country?: string;
};

/** Hash a /24 (v4) or /48 (v6) prefix with the server salt. */
function ipPrefix(ip?: string): string | null {
  if (!ip) return null;
  let prefix = ip;
  if (ip.includes(':')) {
    // crude v6 /48 — first 3 groups
    const parts = ip.split(':').filter(Boolean).slice(0, 3);
    prefix = parts.join(':') + '::';
  } else {
    // v4 /24
    const parts = ip.split('.');
    if (parts.length === 4) prefix = `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  return crypto.createHmac('sha256', IP_SALT).update(prefix).digest('hex').slice(0, 16);
}

function uaKind(ua?: string): 'bot' | 'mobile' | 'tablet' | 'desktop' | null {
  if (!ua) return null;
  const u = ua.toLowerCase();
  if (/bot|crawler|spider|preview|pingdom|monitor|headless|wget|curl|python-requests/.test(u)) return 'bot';
  if (/ipad|tablet/.test(u)) return 'tablet';
  if (/mobi|android|iphone/.test(u)) return 'mobile';
  return 'desktop';
}

function referrerHost(ref?: string): string | null {
  if (!ref) return null;
  try { return new URL(ref).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

/** Try to pull a search query from common referrer patterns. */
function queryFromReferrer(ref?: string): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return u.searchParams.get('q')
      || u.searchParams.get('query')
      || u.searchParams.get('p')
      || null;
  } catch { return null; }
}

export async function ingestEvent(ev: IngestEvent, ctx: IngestContext): Promise<{ ok: boolean }> {
  const kind = uaKind(ctx.ua);
  if (kind === 'bot') return { ok: true };   // silently drop

  const row = {
    post_id: ev.post_id,
    domain_id: ev.domain_id,
    type: ev.type,
    session_id: ev.session_id?.slice(0, 64) ?? '',
    referrer: ev.referrer?.slice(0, 500) ?? null,
    referrer_host: referrerHost(ev.referrer),
    utm_source: ev.utm_source?.slice(0, 80) ?? null,
    utm_medium: ev.utm_medium?.slice(0, 80) ?? null,
    utm_campaign: ev.utm_campaign?.slice(0, 120) ?? null,
    query: (ev.query ?? queryFromReferrer(ev.referrer))?.slice(0, 200) ?? null,
    outbound_url: ev.outbound_url?.slice(0, 500) ?? null,
    scroll_depth: typeof ev.scroll_depth === 'number' ? Math.min(100, Math.max(0, Math.round(ev.scroll_depth))) : null,
    dwell_ms: typeof ev.dwell_ms === 'number' ? Math.max(0, Math.round(ev.dwell_ms)) : null,
    country: ctx.country?.toUpperCase().slice(0, 2) ?? null,
    ua_kind: kind ?? null,
    ip_prefix: ipPrefix(ctx.ip),
  };

  if (!row.post_id || !row.domain_id || !row.session_id) return { ok: false };

  const sb = supabaseAdmin();
  // Both ids are attacker-supplied (this is a public, CORS-open endpoint). Only
  // accept an event for a real *published* post that belongs to the claimed
  // domain — otherwise anyone could forge views/conversions and pollute the
  // analytics that drive the monthly strategy agent and the owner dashboard.
  const { data: post } = await sb
    .from('posts').select('id')
    .eq('id', row.post_id).eq('domain_id', row.domain_id).eq('status', 'published')
    .maybeSingle();
  if (!post) return { ok: false };

  const { error } = await sb.from('post_events').insert(row);
  return { ok: !error };
}
