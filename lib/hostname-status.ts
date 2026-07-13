/**
 * Pure classification for the custom-blog-hostname setup checklist.
 *
 * The dashboard polls /api/domains/hostname-status, which probes three real
 * things — is the host attached to grove's Vercel project, does DNS point at
 * Vercel, is HTTPS actually serving the blog — and this module turns those
 * probes into the three-step checklist the form renders. Pure so the
 * classification (the part that can silently lie to a customer) is unit-tested;
 * the route owns the I/O.
 */

/** Vercel's anycast apex IP — an A record here works as well as the CNAME. */
export const VERCEL_APEX_IP = '76.76.21.21';
export const VERCEL_CNAME = 'cname.vercel-dns.com';

export type HostnameProbe = {
  hostname: string;
  /** Vercel project attach state (from lib/vercel/domains getProjectDomain). */
  attach: 'attached' | 'not_attached' | 'skipped' | 'error';
  attachMessage?: string;
  /** First CNAME target for the host (trailing dot stripped), if any. */
  cnameTarget?: string | null;
  /** A records, for setups that flatten the CNAME at the apex/ALIAS level. */
  aRecords?: string[];
  /** Did https://{host}/robots.txt serve grove's per-blog robots? */
  serving?: boolean;
};

export type SetupStep = {
  id: 'attach' | 'dns' | 'live';
  ok: boolean;
  label: string;
  hint?: string;
};

/** The DNS record's host label a registrar UI usually wants — the subdomain
 *  part relative to the zone (best-effort: the first label). */
export function recordLabel(hostname: string): string {
  return hostname.split('.')[0] || 'blog';
}

/** True when the host's DNS resolves toward Vercel (CNAME or flattened A). */
export function dnsPointsAtVercel(cnameTarget?: string | null, aRecords?: string[]): boolean {
  const target = (cnameTarget ?? '').toLowerCase().replace(/\.$/, '');
  if (target.endsWith('vercel-dns.com')) return true;
  return (aRecords ?? []).includes(VERCEL_APEX_IP);
}

export function buildSetupSteps(p: HostnameProbe): { steps: SetupStep[]; allOk: boolean } {
  const dnsOk = dnsPointsAtVercel(p.cnameTarget, p.aRecords);
  const target = (p.cnameTarget ?? '').replace(/\.$/, '');

  const attach: SetupStep = {
    id: 'attach',
    ok: p.attach === 'attached',
    label: 'Connected to grove',
    hint:
      p.attach === 'attached' ? undefined
      : p.attach === 'skipped'
        ? `auto-connect isn't configured — add ${p.hostname} to the Vercel project (Domains tab)`
      : p.attach === 'not_attached'
        ? 'press Save again to retry — grove also re-connects it automatically every night'
      : p.attachMessage || 'could not reach Vercel — will retry automatically',
  };

  const dns: SetupStep = {
    id: 'dns',
    ok: dnsOk,
    label: 'DNS record added',
    hint: dnsOk
      ? undefined
      : target
        ? `currently points at ${target} — change it to ${VERCEL_CNAME}`
        : 'no record found yet — add the CNAME below at your domain registrar',
  };

  const live: SetupStep = {
    id: 'live',
    ok: p.serving === true,
    label: 'Serving with HTTPS',
    hint: p.serving
      ? undefined
      : dnsOk
        ? 'record found — certificate is provisioning, usually live within minutes'
        : 'waiting on the DNS record above',
  };

  const steps = [attach, dns, live];
  return { steps, allOk: steps.every((s) => s.ok) };
}
