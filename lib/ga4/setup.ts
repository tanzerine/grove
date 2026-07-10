/**
 * Resolve and store the domain's GA4 property right after the Google OAuth
 * completes — the one-click path, same spirit as search-console/setup.ts's
 * ensurePropertyOnConnect. Entirely best-effort: GA is a bonus signal on top of
 * Search Console, so any failure here (API not enabled, no property, missing
 * scope on an older token) must never break the connect flow. It just leaves
 * ga4_property_id null and the dashboard shows GSC + first-party as before.
 */
import { supabaseAdmin } from '../supabase/admin';
import { resolveProperty } from './client';

export async function ensureGa4OnConnect(
  domainId: string,
  hostname: string,
  accessToken: string,
): Promise<{ propertyId: string | null }> {
  try {
    const propertyId = await resolveProperty(accessToken, hostname);
    if (!propertyId) return { propertyId: null };
    await supabaseAdmin()
      .from('domains')
      .update({ ga4_property_id: propertyId, ga4_connected_at: new Date().toISOString() })
      .eq('id', domainId);
    return { propertyId };
  } catch (e: any) {
    console.error('[ga4] property resolve failed', domainId, e?.message ?? e);
    return { propertyId: null };
  }
}
