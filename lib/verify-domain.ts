/**
 * DNS TXT + HTTP file-based domain ownership verification.
 * Two channels, matches the marketing promise: "DNS record OR file at site root".
 */
import { promises as dns } from 'node:dns';

export type VerifyResult = { ok: true; via: 'dns' | 'http' } | { ok: false; reason: string };

const HTTP_PATH = '/.well-known/grove-verify.txt';

export async function verifyDomainOwnership(host: string, token: string): Promise<VerifyResult> {
  // 1) DNS TXT on the apex (or _grove subdomain — try both)
  for (const fqdn of [host, `_grove.${host}`]) {
    try {
      const records = await dns.resolveTxt(fqdn);
      const flat = records.map((r) => r.join('')).join(' ');
      if (flat.includes(`grove-verify=${token}`)) return { ok: true, via: 'dns' };
    } catch { /* keep trying */ }
  }

  // 2) HTTP file at /.well-known/grove-verify.txt
  for (const scheme of ['https', 'http'] as const) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${scheme}://${host}${HTTP_PATH}`, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (res.ok) {
        const body = (await res.text()).trim();
        if (body === token) return { ok: true, via: 'http' };
      }
    } catch { /* keep trying */ }
  }

  return { ok: false, reason: 'No matching DNS TXT or verification file found yet. DNS can take up to 24h to propagate.' };
}

export function makeBlogSlug(host: string) {
  const base = host.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base.slice(0, 30)}-${suffix}`;
}

export function normalizeHost(input: string) {
  return input.replace(/^https?:\/\//, '').replace(/\/$/, '').trim().toLowerCase();
}
