/**
 * Dynamic robots.txt — lists one sitemap per verified domain so crawlers
 * discover every hosted blog without waiting on external links.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appBase } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = appBase();
  const sb = supabaseAdmin();
  const { data: domains } = await sb
    .from('domains').select('blog_slug')
    .not('verified_at', 'is', null)
    .limit(500);

  const sitemaps = (domains ?? [])
    .map((d) => `Sitemap: ${base}/b/${d.blog_slug}/sitemap.xml`)
    .join('\n');

  const body = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /api/
Disallow: /onboarding
Disallow: /login
Disallow: /signup
Disallow: /auth/

${sitemaps}
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
