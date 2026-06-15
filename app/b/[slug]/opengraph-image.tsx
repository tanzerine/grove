/**
 * Open Graph image for the blog home — a branded 1200×630 card so sharing the
 * blog index (e.g. the "Powered by" link from the embed) gets a rich preview
 * instead of a bare link. File-based metadata convention: Next wires this into
 * og:image + twitter:image for /b/[slug] automatically.
 */
import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Blog';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains').select('hostname,site_profile').eq('blog_slug', slug).single();

  const hostname = (domain?.hostname ?? 'grove blog').replace(/^www\./, '');
  const profile = (domain as any)?.site_profile ?? null;
  const business = profile?.business?.name || hostname;
  const accent = sanitizeHex(profile?.branding?.primary_color) || '#4e9e6a';
  const tagline = clamp(profile?.business?.description || 'Grown by grove. Updated on autopilot.', 130);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', padding: '72px 80px',
          background: '#10231a', color: '#ffffff', fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: accent, marginRight: 18 }} />
          <span style={{ fontSize: 30, letterSpacing: 2, textTransform: 'uppercase', color: accent }}>Blog</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.05 }}>
            The {clamp(business, 36)} blog
          </div>
          <div style={{ display: 'flex', fontSize: 30, color: 'rgba(255,255,255,0.72)', marginTop: 22, maxWidth: 1040 }}>
            {tagline}
          </div>
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
    size,
  );
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function sanitizeHex(v: unknown): string | null {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : null;
}
