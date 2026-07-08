/**
 * URL slug for a generated post: lowercase ASCII alphanumerics and hyphens.
 *
 * Titles with no ASCII-representable characters at all (Korean-only, emoji)
 * used to slugify to an EMPTY string — the article then published at the
 * blog-home URL and every canonical/sitemap/social link collided. Those fall
 * back to a stable id-derived slug instead. Accented Latin is folded (é → e)
 * rather than dropped.
 */
export function postSlug(title: string | null | undefined, fallbackId?: string | null): string {
  const s = (title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
  if (s) return s;
  const id = (fallbackId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return id ? `post-${id}` : 'post';
}
