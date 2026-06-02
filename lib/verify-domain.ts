/**
 * DNS TXT + HTTP file-based domain ownership verification.
 * Tolerant of apex/www variants: we'll find the token if it lives at either.
 */
import { promises as dns } from 'node:dns';

export type VerifyResult = { ok: true; via: 'dns' | 'http'; matched: string } | { ok: false; reason: string };

const HTTP_PATH = '/.well-known/grove-verify.txt';

/** Given user input "oveners.com" or "www.oveners.com", return both variants. */
function hostVariants(host: string): string[] {
  const apex = host.replace(/^www\./, '');
  return Array.from(new Set([host, apex, `www.${apex}`]));
}

export async function verifyDomainOwnership(host: string, token: string): Promise<VerifyResult> {
  const hosts = hostVariants(host);

  // 1) DNS TXT on apex, www, OR _grove.<apex> — covers every common spot
  for (const h of [...hosts, ...hosts.map((x) => `_grove.${x}`)]) {
    try {
      const records = await dns.resolveTxt(h);
      const flat = records.map((r) => r.join('')).join(' ');
      if (flat.includes(`grove-verify=${token}`)) return { ok: true, via: 'dns', matched: h };
    } catch { /* keep trying */ }
  }

  // 2) HTTP file at /.well-known/grove-verify.txt on either variant, either scheme.
  //    We follow redirects, so www→apex (or apex→www) is also fine as long as
  //    the file is served on whichever side the redirect lands.
  for (const h of hosts) {
    for (const scheme of ['https', 'http'] as const) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${scheme}://${h}${HTTP_PATH}`, { signal: ctrl.signal, redirect: 'follow' });
        clearTimeout(t);
        if (res.ok) {
          const body = (await res.text()).trim();
          if (body === token) return { ok: true, via: 'http', matched: `${scheme}://${h}` };
        }
      } catch { /* keep trying */ }
    }
  }

  return {
    ok: false,
    reason: `No matching DNS TXT or verification file found on ${hosts.join(', ')}. DNS can take up to 24h to propagate.`,
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
