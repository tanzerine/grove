import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogPostUrl, canonicalBaseFor } from '@/lib/seo';
import { genreFor, authorFor } from '@/lib/blog-genre';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  // ?limit (1–24, default 12) and ?page for older articles
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains').select('*').eq('blog_slug', slug).single(); // '*': survives pre-0018 DB
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: posts, count } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at,format:research->brief->>format', { count: 'exact' })
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const author = authorFor((domain as any).site_profile, domain.hostname);
  const total = count ?? posts?.length ?? 0;

  return NextResponse.json({
    domain: domain.hostname,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    posts: (posts ?? []).map((p: any) => ({
      title: p.title,
      excerpt: p.meta_description,
      url: blogPostUrl(slug, p.slug, canonicalBaseFor(domain)),
      date: p.published_at,
      genre: genreFor(p.format, p.title).label,
      author,
    })),
  }, { headers: { 'access-control-allow-origin': '*' } });
}
