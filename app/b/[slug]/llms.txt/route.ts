/**
 * Per-blog llms.txt — served at {slug}.{root}/llms.txt via the middleware
 * host-rewrite (and at /b/{slug}/llms.txt otherwise). The llmstxt.org standard:
 * a markdown index that lets AI answer engines discover and cite the blog's
 * articles. Pairs with the FAQ/answer-first content (see lib/pipeline/writer.ts)
 * to make the blog as legible to ChatGPT/Perplexity as it is to Google.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildLlmsTxt, canonicalBaseFor } from '@/lib/seo';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains').select('*').eq('blog_slug', slug).single(); // '*': survives pre-0018 DB
  if (!domain) return new Response('not found', { status: 404 });

  const { data: posts } = await sb
    .from('posts').select('slug,title,meta_description')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(500);

  const description = (domain as any).site_profile?.business?.description ?? null;
  const body = buildLlmsTxt({
    hostname: domain.hostname,
    blogSlug: slug,
    canonicalBase: canonicalBaseFor(domain as any),
    description,
    posts: posts ?? [],
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
