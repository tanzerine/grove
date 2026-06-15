/**
 * Dynamic Open Graph image for an article — a branded 1200×630 card used as the
 * social/link-preview fallback when a post has no cover. generateMetadata points
 * og:image / twitter:image here only when cover_image_url is absent, so real
 * covers always win. Better previews = more clicks when a post is shared, which
 * is the whole point of the blog (exposure).
 */
import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const SIZE = { width: 1200, height: 630 };

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains').select('id,hostname,site_profile').eq('blog_slug', slug).single();
  const { data: p } = domain
    ? await sb.from('posts').select('title')
        .eq('domain_id', domain.id).eq('slug', post).eq('status', 'published').single()
    : { data: null };

  const hostname = (domain?.hostname ?? 'grove blog').replace(/^www\./, '');
  const profile = (domain as any)?.site_profile ?? null;
  const business = profile?.business?.name || hostname;
  const accent = sanitizeHex(profile?.branding?.primary_color) || '#4e9e6a';
  const title = clamp(p?.title || hostname, 120);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', padding: '72px 80px',
          background: '#10231a', color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: accent, marginRight: 18 }} />
          <span style={{ fontSize: 30, letterSpacing: 2, textTransform: 'uppercase', color: accent }}>
            {clamp(business, 42)}
          </span>
        </div>

        <div style={{ display: 'flex', fontSize: 66, fontWeight: 700, lineHeight: 1.08, maxWidth: 1040 }}>
          {title}
        </div>

        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 26, color: 'rgba(255,255,255,0.66)',
          }}
        >
          <span>{hostname}</span>
          <span>Grown by grove</span>
        </div>
      </div>
    ),
    SIZE,
  );
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Only allow a #rgb / #rrggbb literal; anything else falls back to the brand green. */
function sanitizeHex(v: unknown): string | null {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : null;
}
