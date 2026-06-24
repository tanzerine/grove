/**
 * Self-serve Search Console onboarding.
 *
 * Grove drives the whole Google dance so the customer never opens the Search
 * Console UI: list properties → if one already matches the domain, use it;
 * otherwise hand back the single DNS TXT record to add, then verify the domain
 * and add the property — all via the Site Verification + Search Console APIs.
 *
 * The one thing Grove can't do for a bring-your-own domain is prove control of
 * it — Google checks a token on the customer's own DNS — so exactly one record
 * is on the customer (bundled with Grove's own domain-verify so it's one trip).
 */
import {
  accessTokenFromRefresh, loadRefreshToken, listSites, matchSite,
  getVerificationToken, verifyDomain, addSite, setSite, domainProperty, verificationIdentifier,
} from './client';
import { syncDomain } from './sync';

export type SetupStatus =
  | { status: 'disconnected' }
  | { status: 'verified'; siteUrl: string }
  | { status: 'needs_dns'; host: string; record: string; property: string }
  | { status: 'dns_not_found' }
  | { status: 'error'; reason: string };

/**
 * Called right after OAuth. If the user already has a matching verified
 * property, wire it up (the happy "one-click" path for anyone already on GSC).
 * Otherwise leave the connection pending — the panel will show the DNS step.
 */
export async function ensurePropertyOnConnect(
  domainId: string, hostname: string, accessToken: string,
): Promise<SetupStatus> {
  try {
    const sites = await listSites(accessToken);
    const existing = matchSite(sites, hostname);
    if (existing) {
      await setSite(domainId, existing);
      syncDomain(domainId).catch(() => { /* cron will retry */ });
      return { status: 'verified', siteUrl: existing };
    }
    return { status: 'needs_dns', host: verificationIdentifier(hostname), record: '', property: domainProperty(hostname) };
  } catch (e: any) {
    return { status: 'error', reason: e?.message ?? 'list_failed' };
  }
}

/** What the dashboard polls to render the right state (verified / needs-DNS). */
export async function setupStatus(domainId: string, hostname: string): Promise<SetupStatus> {
  const refresh = await loadRefreshToken(domainId);
  if (!refresh) return { status: 'disconnected' };

  try {
    const accessToken = await accessTokenFromRefresh(refresh);
    // The user may have verified in the meantime (or already had the property).
    const sites = await listSites(accessToken);
    const existing = matchSite(sites, hostname);
    if (existing) {
      await setSite(domainId, existing);
      syncDomain(domainId).catch(() => { /* best effort */ });
      return { status: 'verified', siteUrl: existing };
    }
    const record = await getVerificationToken(accessToken, hostname);
    return {
      status: 'needs_dns',
      host: verificationIdentifier(hostname),
      record,
      property: domainProperty(hostname),
    };
  } catch (e: any) {
    return { status: 'error', reason: e?.message ?? 'setup_failed' };
  }
}

/** "I've added the record" → verify the domain and add the property. */
export async function verifyAndAdd(domainId: string, hostname: string): Promise<SetupStatus> {
  const refresh = await loadRefreshToken(domainId);
  if (!refresh) return { status: 'disconnected' };

  try {
    const accessToken = await accessTokenFromRefresh(refresh);
    const ok = await verifyDomain(accessToken, hostname);
    if (!ok) return { status: 'dns_not_found' };

    const property = domainProperty(hostname);
    await addSite(accessToken, property);
    await setSite(domainId, property);
    syncDomain(domainId).catch(() => { /* cron will retry */ });
    return { status: 'verified', siteUrl: property };
  } catch (e: any) {
    return { status: 'error', reason: e?.message ?? 'verify_failed' };
  }
}
