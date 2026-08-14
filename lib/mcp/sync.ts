/**
 * What a re-sync should actually do.
 *
 * The agent greps its own content directory for grove frontmatter, hands the
 * result over, and gets back four lists instead of a judgement call. Grove
 * computes it rather than the agent because the checksum is grove's — the
 * agent can read one back out of a file, but it can't recompute one from a
 * file to check.
 *
 * Pure, so the classification is testable to the edge cases that actually
 * happen: a file the agent wrote before checksums existed, an article
 * unpublished upstream, a truncated remote list.
 */

export type RemoteArticle = {
  slug: string;
  checksum: string;
  title?: string | null;
  published_at?: string | null;
};

export type LocalArticle = {
  slug: string;
  /** The `groveChecksum` read back out of the file's frontmatter, if it has
   *  one. Absent means "grove can't tell whether this is current". */
  checksum?: string | null;
  /** Where the agent found it — echoed back so the plan names real files. */
  path?: string | null;
};

export type SyncItem = {
  slug: string;
  title?: string | null;
  path?: string | null;
  checksum?: string;
  reason: string;
};

export type SyncPlan = {
  create: SyncItem[];
  update: SyncItem[];
  unchanged: string[];
  orphaned: SyncItem[];
  /** False when the remote list was truncated — orphan detection is suppressed
   *  and the caller is told why, because deleting files based on a partial
   *  list would remove articles that are simply on the next page. */
  remote_complete: boolean;
  summary: string;
};

export function planSync(
  remote: RemoteArticle[],
  local: LocalArticle[],
  opts: { remoteComplete?: boolean } = {},
): SyncPlan {
  const remoteComplete = opts.remoteComplete !== false;

  // Last write wins on duplicate slugs so a caller that passed the same file
  // twice gets one entry, not two contradictory ones.
  const localBySlug = new Map<string, LocalArticle>();
  for (const l of local ?? []) {
    const slug = normalizeSlug(l?.slug);
    if (slug) localBySlug.set(slug, { ...l, slug });
  }

  const create: SyncItem[] = [];
  const update: SyncItem[] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();

  for (const r of remote ?? []) {
    const slug = normalizeSlug(r?.slug);
    if (!slug) continue;
    seen.add(slug);
    const match = localBySlug.get(slug);

    if (!match) {
      create.push({ slug, title: r.title ?? null, checksum: r.checksum, reason: 'published on grove, not in your content layer yet' });
      continue;
    }
    if (!match.checksum) {
      // A file that predates the sync, or one whose frontmatter was remapped
      // without keeping groveChecksum. It may well be identical — but nothing
      // here can prove that, and serving a stale article is the failure mode
      // this whole feature exists to prevent.
      update.push({
        slug, title: r.title ?? null, path: match.path ?? null, checksum: r.checksum,
        reason: 'no groveChecksum in the file — rewrite once to adopt it, then this article goes quiet',
      });
      continue;
    }
    if (match.checksum !== r.checksum) {
      update.push({
        slug, title: r.title ?? null, path: match.path ?? null, checksum: r.checksum,
        reason: 'the article changed on grove since this file was written',
      });
      continue;
    }
    unchanged.push(slug);
  }

  const orphaned: SyncItem[] = remoteComplete
    ? [...localBySlug.values()]
        .filter((l) => !seen.has(l.slug))
        .map((l) => ({
          slug: l.slug,
          path: l.path ?? null,
          reason: 'no published grove article with this slug — unpublished, renamed, or not ours',
        }))
    : [];

  return {
    create,
    update,
    unchanged,
    orphaned,
    remote_complete: remoteComplete,
    summary: summarize({ create, update, unchanged, orphaned, remoteComplete }),
  };
}

function normalizeSlug(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s || null;
}

function summarize(p: {
  create: SyncItem[]; update: SyncItem[]; unchanged: string[]; orphaned: SyncItem[]; remoteComplete: boolean;
}): string {
  const bits: string[] = [];
  bits.push(`${p.create.length} to add`);
  bits.push(`${p.update.length} to rewrite`);
  bits.push(`${p.unchanged.length} already current`);
  if (p.remoteComplete) {
    bits.push(
      p.orphaned.length === 0
        ? 'nothing orphaned'
        : `${p.orphaned.length} local file${p.orphaned.length === 1 ? '' : 's'} with no published article`,
    );
  }
  const tail = p.remoteComplete
    ? ''
    : ' Orphan detection skipped: grove returned a partial list, so a missing slug may just be on the next page — do not delete anything from this plan.';
  const nothing = p.create.length === 0 && p.update.length === 0;
  return `${bits.join(', ')}.${nothing ? ' Nothing to write.' : ''}${tail}`;
}
