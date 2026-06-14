/**
 * SSRF guard for server-side fetches whose target is influenced by a customer
 * (the outbound share webhook URL and the domain-verification host).
 *
 * Both are owner-controlled, so without a guard an authenticated customer could
 * point Grove's server at internal addresses — cloud metadata (169.254.169.254),
 * loopback, RFC-1918 ranges, link-local — and use the server as a proxy into the
 * private network. We block literal private IPs, well-known internal hostnames,
 * and (to defeat DNS-rebinding at check time) any hostname that resolves to a
 * private address.
 */
import { promises as dns } from 'node:dns';
import net from 'node:net';

/** True for IPs that must never be the target of a server-side fetch. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;          // this-host, RFC1918, loopback
    if (a === 169 && b === 254) return true;                    // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;           // RFC1918
    if (a === 192 && b === 168) return true;                    // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT (RFC6598)
    if (a >= 224) return true;                                  // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (v === '::1' || v === '::') return true;                 // loopback / unspecified
    if (v.startsWith('fe80')) return true;                      // link-local
    if (v.startsWith('fc') || v.startsWith('fd')) return true;  // unique-local
    const mapped = v.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // unparseable → treat as unsafe
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h === 'metadata.google.internal') return true;
  return h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal');
}

async function resolveAll(host: string): Promise<string[]> {
  const out = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  return out.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/**
 * Validate that `raw` is an http(s) URL pointing at a public host. Throws on
 * anything unsafe. Returns the parsed URL when allowed.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('invalid url'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('unsupported scheme');

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) throw new Error('blocked host');

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private address not allowed');
    return u;
  }

  const ips = await resolveAll(host);
  if (!ips.length) throw new Error('host did not resolve');
  if (ips.some(isPrivateIp)) throw new Error('host resolves to a private address');
  return u;
}

/** Non-throwing convenience wrapper. */
export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  try { await assertPublicHttpUrl(raw); return true; } catch { return false; }
}
