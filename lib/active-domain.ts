import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalFields } from './seo';

/**
 * "Active site" selection for the multi-site (Instagram-style) switcher.
 *
 * A user can connect several websites (domains rows). The one they're currently
 * managing is remembered in a cookie. Everything is RLS-scoped to the user, so
 * the cookie can only ever select among their OWN domains — a stale/forged
 * cookie value falls back to the first verified (else first) domain.
 */
export const ACTIVE_DOMAIN_COOKIE = 'grove_active_domain';

/**
 * Intersecting CanonicalFields is what lets a row go straight into the lib/seo
 * builders — `canonicalBaseFor(domain)` rather than `canonicalBaseFor(domain as
 * any)`. The index signature below does NOT satisfy those builders' weak-type
 * check, so before this the only way through was a cast, and a cast there would
 * have equally accepted a row that had never selected the columns.
 */
export type DomainRow = CanonicalFields & {
  id: string;
  hostname: string;
  verified_at: string | null;
  // Named because they carry real meaning at call sites (blog URLs, ownership)
  // and the index signature would otherwise type them `any`. Optional but NOT
  // nullable: both are NOT NULL in the schema, so the only way to not have one
  // is a getActiveDomainFields() call whose `columns` left it out.
  blog_slug?: string;
  user_id?: string;
  // select('*') brings extra columns (auto_publish, site_profile, gsc_*, …);
  // keep them loosely typed like the prior raw query so callers aren't broken.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

/**
 * Which row the switcher is pointing at. Exported so the selection rule is
 * testable on its own — it is the difference between editing the site you are
 * looking at and editing a different one.
 */
export function pickActive(rows: DomainRow[], wanted: string | undefined): DomainRow | null {
  if (!rows.length) return null;
  if (wanted) {
    const match = rows.find((d) => d.id === wanted);
    if (match) return match;
  }
  return rows.find((d) => d.verified_at) ?? rows[0];
}

/**
 * Active-domain row narrowed to `columns`.
 *
 * For CLIENT-FACING routes, which must not ship the whole row: `select('*')`
 * carries gsc_refresh_token, github_repo_token and social_webhook_secret, so
 * getActiveDomain is for server components only.
 *
 * `columns` MUST include `id` and `verified_at` — pickActive matches the cookie
 * on the former and falls back on the latter.
 */
export async function getActiveDomainFields(
  sb: SupabaseClient,
  columns: string,
): Promise<DomainRow | null> {
  const { data } = await sb.from('domains').select(columns).order('created_at');
  const jar = await cookies();
  return pickActive((data ?? []) as unknown as DomainRow[], jar.get(ACTIVE_DOMAIN_COOKIE)?.value);
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
