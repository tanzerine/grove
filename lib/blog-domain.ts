/**
 * Resolve a public hostname (apex or www) to the ONE domain row whose blog
 * should serve at that host.
 *
 * A single hostname can map to more than one `domains` row — e.g. a stale,
 * unverified, empty duplicate created under a different account sitting next to
 * the customer's real, populated blog. The old resolver ordered only by
 * `verified_at DESC`, so the instant that empty duplicate got verified it would
 * win `.limit(1)` and silently retarget every list/feed/beacon at a blog with
 * zero posts — the live blog goes blank and the owner's analytics drop to zero.
 *
 * The fix: prefer the row that actually OWNS PUBLISHED CONTENT. An empty row can
 * never hijack a populated blog regardless of when it was verified. Verified-
 * first is kept as a secondary sort so the original intent still holds when two
 * candidates are otherwise equivalent.
 *
 * `pickBlogDomain` is the pure, unit-tested ranking; `resolveBlogDomain` wires it
 * to Supabase. Both embed endpoints (list + article) call `resolveBlogDomain` so
 * their choice can never diverge.
 */

export type DomainCandidate = {
  verified_at?: string | null;
  custom_blog_hostname?: string | null;
  /** Count of this domain's `published` posts. */
  published_count: number;
};

/**
 * Deterministically pick the best domain row for a hostname from all candidates
 * sharing it. Pure so it can be unit-tested without a database.
 *
 * Order of preference:
 *   1. Owns published content (`published_count > 0`) over one that doesn't.
 *   2. More published posts.
 *   3. Verified over unverified, then newer `verified_at` (original intent).
 *   4. Has a configured `custom_blog_hostname` (an intentionally set-up blog).
 */
export function pickBlogDomain<T extends DomainCandidate>(rows: T[]): T | null {
  if (!rows || rows.length === 0) return null;
  return [...rows].sort(compareBlogDomain)[0] ?? null;
}

/** Comparator: returns <0 when `a` should rank ahead of `b`. */
export function compareBlogDomain(a: DomainCandidate, b: DomainCandidate): number {
  // 1. A domain with any published content beats one with none.
  const aHas = a.published_count > 0;
  const bHas = b.published_count > 0;
  if (aHas !== bHas) return aHas ? -1 : 1;

  // 2. More published posts wins.
  if (a.published_count !== b.published_count) return b.published_count - a.published_count;

  // 3. Verified-first, newer verification first (mirrors the old
  //    `order('verified_at', { ascending: false, nullsFirst: false })`).
  const av = a.verified_at ?? null;
  const bv = b.verified_at ?? null;
  if (!!av !== !!bv) return av ? -1 : 1;
  if (av && bv && av !== bv) return av < bv ? 1 : -1;

  // 4. A configured custom blog hostname is a final tiebreak.
  const ah = a.custom_blog_hostname ? 1 : 0;
  const bh = b.custom_blog_hostname ? 1 : 0;
  return bh - ah;
}

/** Minimal shape of the Supabase client this module needs. */
type Sb = {
  from: (table: string) => any;
};

/**
 * Fetch every domain row that owns `apex` (or its www variant) and return the
 * best one per {@link pickBlogDomain}. Returns null when no row matches.
 *
 * The common case is exactly one row — we short-circuit and skip the extra
 * post-count queries there. Only a genuine duplicate triggers the count lookups
 * needed to break the tie in favor of the populated blog.
 */
export async function resolveBlogDomain(sb: Sb, apex: string): Promise<any | null> {
  const { data: rows } = await sb
    .from('domains')
    .select('*') // '*': survives DBs where newer columns aren't applied yet
    .or(`hostname.eq.${apex},hostname.eq.www.${apex}`);

  const candidates: any[] = rows ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Duplicate hostname: count each row's published posts so a populated blog
  // always outranks an empty one.
  const counts = await Promise.all(
    candidates.map(async (row) => {
      const { count } = await sb
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('domain_id', row.id)
        .eq('status', 'published');
      return count ?? 0;
    }),
  );

  const ranked = candidates.map((row, i) => ({ ...row, published_count: counts[i] }));
  return pickBlogDomain(ranked);
}
