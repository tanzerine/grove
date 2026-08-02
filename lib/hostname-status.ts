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

/**
 * Vercel anycast addresses seen in the wild for an A-record setup — apex
 * records, and registrars/proxies that flatten a CNAME into A.
 *
 * This list ROTS, and it already had: the single IP here used to be
 * 76.76.21.21, which today matches nothing — trygroveai.com's own apex answers
 * 216.198.79.1 and cname.vercel-dns.com resolves to 76.76.21.22 / 66.33.60.129.
 * A customer whose registrar hands back A records was therefore told "no record
 * found yet" by a checklist looking at correct DNS.
 *
 * So the list is a HINT, not the test. `dnsPointsAtVercel` also accepts any
 * *.vercel-dns.com CNAME, and buildSetupSteps treats a host that is already
 * serving grove's own robots.txt over HTTPS as proof enough — which is the part
 * that can't go stale when Vercel renumbers again.
 */
export const VERCEL_APEX_IPS = ['216.198.79.1', '76.76.21.21', '76.76.21.22', '66.33.60.129'];
/** @deprecated kept for callers that want a single example to display. */
export const VERCEL_APEX_IP = VERCEL_APEX_IPS[0];
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
  return (aRecords ?? []).some((ip) => VERCEL_APEX_IPS.includes(ip.trim()));
}

export function buildSetupSteps(p: HostnameProbe): { steps: SetupStep[]; allOk: boolean } {
  // A host that already serves grove's own robots.txt over HTTPS has working
  // DNS by definition, whatever shape the records take. Checking that first
  // means the recogniser above can fall behind Vercel's addressing without the
  // checklist contradicting a page the customer can already load.
  const dnsOk = p.serving === true || dnsPointsAtVercel(p.cnameTarget, p.aRecords);
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
