import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname,blog_slug').eq('blog_slug', slug).single();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: posts } = await sb
    .from('posts').select('slug,title,meta_description,published_at')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(6);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove.so';
  return NextResponse.json({
    domain: domain.hostname,
    posts: (posts ?? []).map((p) => ({
      title: p.title,
      excerpt: p.meta_description,
      url: `${base}/b/${slug}/${p.slug}`,
      date: p.published_at,
    })),
  }, { headers: { 'access-control-allow-origin': '*' } });
}
