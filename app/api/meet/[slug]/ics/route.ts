import { appBase } from '@/lib/seo';
import { buildIcs, tokenFromSlug } from '@/lib/meetings';
import { meetingByToken } from '@/lib/meetings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The confirmed call as an .ics file. 404 until the owner confirms a time. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const slug = (await ctx.params).slug;
  const token = tokenFromSlug(slug);
  const m = token ? await meetingByToken(token) : null;
  if (!m || m.status !== 'confirmed' || !m.confirmed_start) {
    return new Response('Not found', { status: 404 });
  }
  const ics = buildIcs(m, m.confirmed_start, `${appBase()}/meet/${slug}`, new Date());
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="grove-call.ics"',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
