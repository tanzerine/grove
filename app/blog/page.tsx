/**
 * /blog — grove's own blog, served by grove's own embed (see GroveEmbed).
 *
 * Articles themselves are NOT rendered here: the cards link at grove's
 * server-rendered hosted blog (`/b/{blog_slug}/{post}`), which already has the
 * canonical tag, JSON-LD, sitemap and RSS. That's the embed's `data-article-base`
 * hybrid mode — the same advice we give customers, because a JS-only in-page
 * reader is invisible to crawlers, and an SEO product shipping uncrawlable
 * articles on its own domain would be its own indictment.
 *
 * The base is resolved from the domain row rather than hardcoded, and a failure
 * degrades to the embed's in-page reader instead of breaking the page.
 */
import type { Metadata } from 'next';
import GroveEmbed, { groveEmbedHost } from '@/components/GroveEmbed';
import SiteNav from '@/components/SiteNav';
import { groveBlogLinks } from '@/lib/grove-blog';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    "Every post here was researched, written, quality-gated and published by grove — the same agent loop customers run on their own domain. We read our own dogfood.",
  alternates: { canonical: '/blog' },
  openGraph: { url: '/blog' },
};

// The feed is CDN-cached for 5 minutes anyway; match it.
export const revalidate = 300;

const ACCENT = '#A2FF01';

export default async function Page() {
  // Every published article, server-rendered inside the embed container.
  // embed.js replaces it on mount, so this is what a crawler gets — see
  // lib/grove-blog for the indexing defect it fixes.
  const { base, entries } = await groveBlogLinks(groveEmbedHost());
  const link = { color: '#9a9d97', textDecoration: 'none', fontSize: 14, fontWeight: 500 };

  return (
    <div
      style={{
        background: '#000',
        color: '#f4f4f2',
        minHeight: '100vh',
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* NAV — the landing's own bar, not a copy of it. The copy this replaced
          claimed to be the "same shape as the landing's" and was missing FAQ. */}
      <SiteNav active="Blog" />

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px 120px' }}>
        <div style={{ maxWidth: 640, marginBottom: 44 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: ACCENT,
              marginBottom: 16,
              fontFamily: "'DM Mono', ui-monospace, monospace",
            }}
          >
            Written by grove
          </div>
          <h1
            style={{
              fontSize: 'clamp(30px, 5vw, 46px)',
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              margin: '0 0 16px',
              fontFamily: "'GT Walsheim', 'Inter', sans-serif",
            }}
          >
            We read our own dogfood.
          </h1>
          <p style={{ fontSize: 18, color: '#9a9d97', lineHeight: 1.6, margin: 0 }}>
            Every post below was researched, written, scored and published by the same agent
            loop our customers run — and this page is grove&rsquo;s own embed, the two-line
            snippet you paste into your site. Nothing here is hand-written.
          </p>
        </div>

        <GroveEmbed mode="blog" articleBase={base}>
          {/* Server-rendered fallback. embed.js assigns `root.innerHTML` on
              mount, so a reader never sees this — a crawler, and anyone
              without JS, sees the whole blog as plain links. */}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.8 }}>
            {entries.map((a) => (
              <li key={a.slug}>
                <a href={a.url} style={{ color: '#f4f4f2', textDecoration: 'none' }}>
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </GroveEmbed>
      </main>

      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '28px 24px',
          fontSize: 12,
          color: '#565952',
        }}
      >
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span>© {new Date().getFullYear()} grove — plant once, grows forever.</span>
          <span style={{ display: 'flex', gap: 18 }}>
            <a href="/" style={{ ...link, fontSize: 12 }}>Home</a>
            {/* The crawlable blog home. It carries a link to every article and
                was, before this, reachable from nothing but a sitemap entry. */}
            {base && <a href={base} style={{ ...link, fontSize: 12 }}>All articles</a>}
            <a href="/privacy" style={{ ...link, fontSize: 12 }}>Privacy</a>
            <a href="/terms" style={{ ...link, fontSize: 12 }}>Terms</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
