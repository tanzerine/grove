import { ImageResponse } from 'next/og';
import { SITE } from '@/lib/site';

/**
 * Branded OG/Twitter card for the marketing site — before this, sharing grove
 * anywhere produced a blank preview (no og:image at all). Next auto-wires this
 * file to og:image and twitter:image. Uses only inline styles + the built-in
 * font so it can't fail on a missing asset. Palette: paper/ink/moss.
 */
export const runtime = 'edge';
export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0b0a',
          padding: '80px',
          color: '#eef1ea',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: '#63c281',
              boxShadow: '0 0 40px rgba(99,194,129,0.7)',
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}>grove</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em', maxWidth: 900 }}>
            <span>Plant your domain. The blog&nbsp;</span>
            <span style={{ color: '#63c281' }}>grows itself.</span>
          </div>
          <div style={{ fontSize: 30, color: '#9aa096', maxWidth: 880, lineHeight: 1.35 }}>
            An AI marketing agent that writes in your voice and auto-publishes SEO posts — built to rank on Google and get cited by ChatGPT.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
