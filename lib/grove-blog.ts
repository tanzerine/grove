/**
 * grove's OWN blog, resolved server-side — the crawlable copy of its article
 * links.
 *
 * Every surface that mounts `public/embed.js` against grove's own domain needs
 * the same two things: the article base the cards link at, and a
 * server-rendered list of those links to sit inside the embed container until
 * the script replaces it. `/blog` needs all of them; the landing's "Our blog
 * runs on Grove" widget needs the newest few.
 *
 * WHY THE SERVER-RENDERED LIST EXISTS. embed.js mounts by assigning
 * `root.innerHTML`, so the container shipped empty and the HTML a crawler
 * received contained no link to any article. grove's 23 posts were reachable
 * from nothing but a sitemap entry, and Search Console's URL Inspection put 9
 * of 24 URLs at "Discovered – currently not indexed": Google had every URL and
 * would not spend crawl budget on pages nothing linked to. Filling the
 * container server-side costs a reader nothing — the script overwrites it
 * milliseconds later — and gives the articles their first inbound link.
 *
 * One module rather than a copy per page, so the landing and /blog cannot
 * drift into pointing at different URLs for the same posts.
 */
import { resolveBlogDomain } from '@/lib/blog-domain';
import { blogHomeUrl, canonicalBaseFor } from '@/lib/seo';
import { archiveEntries, type ArchiveEntry } from '@/lib/blog-archive';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type GroveBlogLinks = {
  /** Absolute URL of the crawlable blog home; null when it can't be resolved. */
  base: string | null;
  entries: ArchiveEntry[];
};

/**
 * `limit` caps the list (the landing widget wants 3; /blog wants everything).
 *
 * Fail-safe by contract: a missing service key or an unreachable DB returns
 * empty rather than throwing. These are public marketing surfaces, and a
 * decorative section must never 500 the page it sits on — the same posture as
 * the auth and testimonial reads around it.
 */
export async function groveBlogLinks(
  host: string,
  limit?: number,
): Promise<GroveBlogLinks> {
  try {
    const sb = supabaseAdmin();
    const domain = await resolveBlogDomain(sb, host);
    if (!domain?.blog_slug) return { base: null, entries: [] };

    const canonicalBase = canonicalBaseFor(domain);
    let q = sb
      .from('posts')
      .select('slug,title,published_at')
      .eq('domain_id', domain.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (limit != null) q = q.limit(limit);
    const { data } = await q;

    return {
      base: blogHomeUrl(domain.blog_slug, canonicalBase),
      entries: archiveEntries(data ?? [], {
        blogSlug: domain.blog_slug,
        canonicalBase,
        cap: limit,
      }),
    };
  } catch {
    return { base: null, entries: [] };
  }
}
