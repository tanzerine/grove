/**
 * GET /article.css — grove's article typography, for customer sites.
 *
 * Two consumers:
 *   - public/embed.js links it before rendering an article in `#grove-blog`
 *   - a customer server-rendering grove content themselves (ovenai's
 *     /blog/[slug], which stays server-rendered for SEO) can <link> it and
 *     delete their hand-maintained fork
 *
 * Public and CORS-open on purpose: it is a stylesheet meant to be loaded from
 * domains we don't control. Cached hard, since it only changes when grove's
 * article design does.
 */
import { ARTICLE_CSS } from '@/lib/blog/article-css';

export const dynamic = 'force-static';

export function GET() {
  return new Response(ARTICLE_CSS, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'access-control-allow-origin': '*',
    },
  });
}
