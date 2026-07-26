/**
 * Give a post a public URL slug before it can go live.
 *
 * Only the generation pipeline used to set `posts.slug` (generate.ts), so a
 * hand-written draft — created by /api/posts/manual from the Write page — had
 * `slug = null`. Publishing one produced `/b/{blog}/null`-shaped URLs across
 * canonical, sitemap, RSS and social, all built from the slug by lib/seo. Now
 * that an author can schedule a draft themselves, every path that flips a post
 * to `scheduled` or `published` backfills the slug from the CURRENT title first.
 *
 * Takes a user-scoped client, so RLS still enforces ownership. Best-effort: a
 * failure returns null and leaves the row alone rather than blocking a publish.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { postSlug, uniqueSlug } from './slug';

export async function ensurePostSlug(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data: post } = await sb
    .from('posts')
    .select('id, slug, title, topic, domain_id')
    .eq('id', id)
    .maybeSingle();
  if (!post) return null;

  const existing = (post as any).slug as string | null;
  if (existing) return existing;

  const base = postSlug((post as any).title || (post as any).topic, id);
  const { data: siblings } = await sb
    .from('posts')
    .select('slug')
    .eq('domain_id', (post as any).domain_id)
    .not('slug', 'is', null);

  const slug = uniqueSlug(
    base,
    (siblings ?? []).map((s: any) => s.slug as string).filter(Boolean),
  );
  const { error } = await sb.from('posts').update({ slug }).eq('id', id);
  return error ? null : slug;
}
