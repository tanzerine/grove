import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * "Active site" selection for the multi-site (Instagram-style) switcher.
 *
 * A user can connect several websites (domains rows). The one they're currently
 * managing is remembered in a cookie. Everything is RLS-scoped to the user, so
 * the cookie can only ever select among their OWN domains — a stale/forged
 * cookie value falls back to the first verified (else first) domain.
 */
export const ACTIVE_DOMAIN_COOKIE = 'grove_active_domain';

export type DomainRow = {
  id: string;
  hostname: string;
  verified_at: string | null;
  // select('*') brings extra columns (auto_publish, site_profile, gsc_*, …);
  // keep them loosely typed like the prior raw query so callers aren't broken.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

function pickActive(rows: DomainRow[], wanted: string | undefined): DomainRow | null {
  if (!rows.length) return null;
  if (wanted) {
    const match = rows.find((d) => d.id === wanted);
    if (match) return match;
  }
  return rows.find((d) => d.verified_at) ?? rows[0];
}

/** Full active-domain row (select *), scoped to the signed-in user. */
export async function getActiveDomain(sb: SupabaseClient): Promise<DomainRow | null> {
  const { data } = await sb.from('domains').select('*').order('created_at');
  const jar = await cookies();
  return pickActive((data ?? []) as DomainRow[], jar.get(ACTIVE_DOMAIN_COOKIE)?.value);
}

/** All of the user's domains plus which one is active — powers the switcher. */
export async function getDomainsWithActive(
  sb: SupabaseClient,
): Promise<{ domains: DomainRow[]; activeId: string | null }> {
  const { data } = await sb
    .from('domains')
    .select('id, hostname, verified_at')
    .order('created_at');
  const jar = await cookies();
  const rows = (data ?? []) as DomainRow[];
  const active = pickActive(rows, jar.get(ACTIVE_DOMAIN_COOKIE)?.value);
  return { domains: rows, activeId: active?.id ?? null };
}
