/**
 * Route Supabase Storage images inside ALREADY-RENDERED article HTML through
 * Vercel's image CDN.
 *
 * The blog post body is markdown → mdToHtml → dangerouslySetInnerHTML, so its
 * <img> tags (the injected cover + flux inline images) can't be swapped for
 * the <Image> component. Instead we rewrite their src to the /_next/image
 * endpoint — the exact URL shape next/image itself emits — so they get the
 * same optimization + CDN caching, and Supabase egress is only paid on Vercel
 * cache misses.
 *
 * Constraints:
 *  - `w` must be one of next/image's configured device sizes (default list
 *    includes 640/750/828/1080/1200/1920…) or the endpoint 400s.
 *  - The Supabase host must be allowlisted in next.config.mjs images.remotePatterns.
 *  - Only for HTML served from OUR deployment (blog pages, incl. subdomain and
 *    custom-hostname blogs — same Vercel app). Do NOT use for the embed API or
 *    RSS: those bodies render on other origins where /_next/image doesn't exist.
 */

const SUPABASE_IMG_SRC =
  /(<img\b[^>]*?\bsrc=")(https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/[^"]+)(")/gi;

export function rewriteImgsToCdn(html: string, opts: { width?: number; quality?: number } = {}): string {
  if (!html) return html;
  const w = opts.width ?? 1200;
  const q = opts.quality ?? 75;
  return html.replace(SUPABASE_IMG_SRC, (_m, pre: string, url: string, post: string) =>
    `${pre}/_next/image?url=${encodeURIComponent(url)}&amp;w=${w}&amp;q=${q}${post}`);
}
