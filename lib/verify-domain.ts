/**
 * Multi-method domain ownership verification — works with any web stack.
 *
 * Verification methods, in order of robustness:
 *   1. DNS TXT     — most reliable. DNS lives above the web framework, so no
 *                    middleware (Clerk, NextAuth, Cloudflare Access) can block it.
 *   2. HTML meta   — easy for non-technical users. Survives most auth setups
 *                    because homepages are usually public.
 *   3. HTTP file   — convenient when DNS access is hard. Can be broken by auth
 *                    middleware that protects /.well-known/ (Clerk, etc.).
 *
 * We check ALL methods in parallel and accept the first match. Customers only
 * need to do ONE — pick whichever is easiest for their setup.
 */
import { promises as dns } from 'node:dns';
import { isPublicHttpUrl } from './net/ssrf';

export type VerifyMethod = 'dns' | 'meta' | 'http';
export type VerifyResult =
  | { ok: true; via: VerifyMethod; matched: string }
  | { ok: false; reason: string; tried: string[] };

const HTTP_PATH = '/.well-known/grove-verify.txt';
const META_NAME = 'grove-verify';
const FETCH_TIMEOUT_MS = 6000;

function hostVariants(host: string): string[] {
  const apex = host.replace(/^www\./, '');
  return Array.from(new Set([host, apex, `www.${apex}`]));
}

async function withTimeout<T>(p: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await p; } catch { return null; } finally { clearTimeout(t); }
}

// ─── method 1: DNS TXT (apex, www, _grove.apex, _grove.www) ──────────────────
async function checkDns(host: string, token: string): Promise<{ matched: string } | null> {
  const variants = hostVariants(host);
  const probes = [...variants, ...variants.map((h) => `_grove.${h}`)];
  for (const h of probes) {
    try {
      const records = await dns.resolveTxt(h);
      const flat = records.map((r) => r.join('')).join(' ');
      if (flat.includes(`grove-verify=${token}`)) return { matched: `DNS TXT @ ${h}` };
    } catch { /* keep trying */ }
  }
  return null;
}

// ─── method 2: HTML meta tag in homepage HEAD ────────────────────────────────
async function fetchHtml(url: string): Promise<string | null> {
  // Owner-controlled host — refuse to fetch anything resolving to a private
  // address (SSRF). DNS-based verification above doesn't touch the host so it
  // still works for legitimately-internal sites.
  if (!(await isPublicHttpUrl(url))) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'grove-verifier/1.0 (+https://grove.so/verify)' },
    });
    if (!res.ok) return null;
    // we only need the HEAD, but cheap to read whole thing for small homepages
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

async function checkMeta(host: string, token: string): Promise<{ matched: string } | null> {
  for (const h of hostVariants(host)) {
    for (const scheme of ['https', 'http'] as const) {
      const html = await fetchHtml(`${scheme}://${h}/`);
      if (!html) continue;
      // tolerant regex: any quoting, any attribute order
      const re = new RegExp(
        `<meta[^>]*name=["']${META_NAME}["'][^>]*content=["']${token}["']|` +
        `<meta[^>]*content=["']${token}["'][^>]*name=["']${META_NAME}["']`,
        'i'
      );
      if (re.test(html)) return { matched: `meta tag @ ${scheme}://${h}` };
    }
  }
  return null;
}

// ─── method 3: HTTP file at /.well-known/grove-verify.txt ────────────────────
async function checkHttpFile(host: string, token: string): Promise<{ matched: string } | null> {
  for (const h of hostVariants(host)) {
    for (const scheme of ['https', 'http'] as const) {
      const fileUrl = `${scheme}://${h}${HTTP_PATH}`;
      if (!(await isPublicHttpUrl(fileUrl))) continue; // SSRF guard
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(fileUrl, {
          signal: ctrl.signal, redirect: 'follow',
          headers: { 'user-agent': 'grove-verifier/1.0' },
        });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') ?? '';
        // reject HTML responses — that means an auth middleware intercepted us
        if (ct.includes('text/html')) continue;
        const body = (await res.text()).trim();
        if (body === token) return { matched: `file @ ${scheme}://${h}${HTTP_PATH}` };
      } catch { /* keep trying */ } finally { clearTimeout(t); }
    }
  }
  return null;
}

export async function verifyDomainOwnership(host: string, token: string): Promise<VerifyResult> {
  // Race all three methods in parallel; first hit wins.
  const tried: string[] = [];
  const results = await Promise.allSettled([
    checkDns(host, token).then((r) => ({ method: 'dns' as const, r })),
    checkMeta(host, token).then((r) => ({ method: 'meta' as const, r })),
    checkHttpFile(host, token).then((r) => ({ method: 'http' as const, r })),
  ]);

  for (const settled of results) {
    if (settled.status !== 'fulfilled') continue;
    const { method, r } = settled.value;
    tried.push(method);
    if (r) return { ok: true, via: method, matched: r.matched };
  }

  return {
    ok: false,
    reason: `No matching DNS TXT, meta tag, or verification file found for ${host} (or its www/apex variants). DNS changes can take a few minutes to propagate.`,
    tried,
  };
}

export function makeBlogSlug(host: string) {
  const base = host.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base.slice(0, 30)}-${suffix}`;
}

export function normalizeHost(input: string) {
  return input.replace(/^https?:\/\//, '').replace(/\/$/, '').trim().toLowerCase();
}
