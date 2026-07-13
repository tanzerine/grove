/**
 * GET /api/domains/hostname-status?domain_id=… — live setup checks for a
 * domain's custom blog hostname (blog.acme.com). The dashboard form polls this
 * after save so the customer watches three real probes go green instead of
 * following instruction paragraphs blind:
 *
 *   attach — is the host on grove's Vercel project? (lib/vercel/domains)
 *   dns    — does the host CNAME to Vercel (or A → Vercel's apex IP)?
 *   live   — is https://{host}/robots.txt serving THIS blog's robots file?
 *
 * Probe I/O lives here; the step classification is pure in
 * lib/hostname-status.ts (unit-tested). Owner-scoped: the domain row must
 * belong to the signed-in user.
 */
import { NextResponse } from 'next/server';
import { promises as dns } from 'node:dns';
import { supabaseServer } from '@/lib/supabase/server';
import { normalizeBlogHostname } from '@/lib/seo';
import { isPublicHttpUrl } from '@/lib/net/ssrf';
import { getProjectDomain } from '@/lib/vercel/domains';
import { buildSetupSteps, recordLabel, VERCEL_CNAME, type HostnameProbe } from '@/lib/hostname-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 6000;

async function probeAttach(host: string): Promise<Pick<HostnameProbe, 'attach' | 'attachMessage'>> {
  const res = await getProjectDomain(host);
  if (res.ok) return { attach: 'attached' };
  if (res.state === 'skipped') return { attach: 'skipped' };
  if (res.message === 'not attached to this project') return { attach: 'not_attached' };
  return { attach: 'error', attachMessage: res.message };
}

async function probeDns(host: string): Promise<Pick<HostnameProbe, 'cnameTarget' | 'aRecords'>> {
  let cnameTarget: string | null = null;
  let aRecords: string[] = [];
  try { cnameTarget = (await dns.resolveCname(host))[0] ?? null; } catch { /* no CNAME */ }
  if (!cnameTarget) {
    try { aRecords = await dns.resolve4(host); } catch { /* no A either */ }
  }
  return { cnameTarget, aRecords };
}

async function probeServing(host: string): Promise<boolean> {
  // Owner-controlled hostname — same SSRF stance as lib/verify-domain: never
  // fetch anything resolving to a private address.
  const url = `https://${host}/robots.txt`;
  if (!(await isPublicHttpUrl(url))) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    // grove's per-blog robots on this host points its sitemap at this same
    // host — a precise marker that it's OUR blog serving, not a parking page.
    const body = await res.text();
    return body.includes(`https://${host}/sitemap.xml`);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domainId = new URL(req.url).searchParams.get('domain_id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(domainId)) {
    return NextResponse.json({ error: 'invalid domain_id' }, { status: 400 });
  }

  const { data: row } = await sb
    .from('domains').select('*') // '*': survives pre-0026 DB
    .eq('id', domainId).eq('user_id', user.id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const host = normalizeBlogHostname((row as any).custom_blog_hostname);
  if (!host) {
    return NextResponse.json({ configured: false }, { headers: { 'cache-control': 'no-store' } });
  }

  const [attach, dnsProbe, serving] = await Promise.all([
    probeAttach(host),
    probeDns(host),
    probeServing(host),
  ]);

  const { steps, allOk } = buildSetupSteps({ hostname: host, ...attach, ...dnsProbe, serving });

  return NextResponse.json(
    {
      configured: true,
      hostname: host,
      record: { type: 'CNAME', host: recordLabel(host), value: VERCEL_CNAME },
      steps,
      allOk,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
