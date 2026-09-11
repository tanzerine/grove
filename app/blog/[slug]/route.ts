/**
 * /blog/[slug] → the article's real URL, permanently.
 *
 * grove has never rendered an article at this path: /blog is the embed list,
 * and the articles live on the hosted blog (`/b/{blog_slug}/{post}`, or the
 * canonical base). But the landing's widget linked every card here until #277,
 * so the shape is out in the world. A 301 onto the real article keeps those
 * links alive and lets Google fold any indexed copy into the canonical one.
 *
 * Unknown slugs 404. Redirecting them to /blog would read as a soft 404 to a
 * crawler and hide a genuinely dead link from us.
 */
import { NextResponse } from 'next/server';
import { groveEmbedHost } from '@/components/GroveEmbed';
import { groveBlogPostUrl } from '@/lib/grove-blog';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = await groveBlogPostUrl(groveEmbedHost(), slug);
  if (!url) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(url, 301);
}
