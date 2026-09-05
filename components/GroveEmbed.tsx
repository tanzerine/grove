/**
 * grove's own blog, rendered by grove's own embed.
 *
 * This is the dogfood: /blog and the landing-page teaser mount the SAME
 * `public/embed.js` a customer pastes into their site, against the same public
 * `/api/embed/host/...` endpoint. There is deliberately no bespoke styling
 * here — if grove's blog looks wrong on grove's site, it looks wrong on every
 * customer's site, so the fix belongs in embed.js (or the API), not in this
 * file. Keep the surface area of this component to embed OPTIONS only.
 *
 * The two knobs we do pass are the two the embed exposes for exactly this:
 *   data-theme="dark"  — our marketing site is dark; the embed themes itself.
 *   data-host          — pin the domain. Auto-detection would look up
 *                        `grove-<hash>.vercel.app` on preview deploys and
 *                        `localhost` in dev, neither of which owns a blog.
 *
 * `children` are the SERVER-RENDERED FALLBACK, and they are not a styling
 * exception to the rule above. embed.js mounts by assigning `root.innerHTML`,
 * so whatever the server put inside the container is replaced the instant the
 * script runs — which makes the container the correct place for the crawlable
 * copy of the list. Before this, `/blog` shipped an empty div: the page a
 * crawler fetched contained zero links to any article, and the only route to
 * grove's 23 posts was a sitemap. This is the same progressive-enhancement
 * slot a customer can fill on their own page, and the snippet on the dashboard
 * embed page now shows it.
 */
import Script from 'next/script';

import { appBase } from '@/lib/seo';

const ACCENT = '#A2FF01';

/** The domain whose grove blog we render — our own canonical host. */
export function groveEmbedHost(): string {
  try {
    return new URL(appBase()).hostname.replace(/^www\./, '');
  } catch {
    return 'trygroveai.com';
  }
}

export default function GroveEmbed({
  mode,
  count,
  blogUrl = '/blog',
  articleBase,
  children,
}: {
  /** 'blog' = the full blog front end; 'widget' = newest-N teaser. */
  mode: 'blog' | 'widget';
  /** widget only — how many cards (embed default 4). */
  count?: number;
  /** widget only — where the cards and "Read the blog →" point. */
  blogUrl?: string;
  /** blog only — link cards at server-rendered article pages instead of the
   *  in-page hash reader, so the articles stay crawlable. */
  articleBase?: string | null;
  /** Server-rendered fallback, replaced by embed.js on mount. See the note
   *  above: this is what a crawler (and a no-JS reader) actually gets. */
  children?: React.ReactNode;
}) {
  return (
    <>
      <div
        id={mode === 'blog' ? 'grove-blog' : 'grove-widget'}
        data-host={groveEmbedHost()}
        data-theme="dark"
        data-accent={ACCENT}
        data-count={mode === 'widget' ? count : undefined}
        data-blog-url={mode === 'widget' ? blogUrl : undefined}
        data-article-base={mode === 'blog' ? articleBase ?? undefined : undefined}
      >
        {children}
      </div>
      {/* A customer drops in a plain `<script async src=".../embed.js">`, which
          is right on a normal page. Here it is NOT: a bare async script can win
          the race against hydration, and React then reconciles the container
          against its own idea of the children — the embed mounts and is wiped
          milliseconds later. `afterInteractive` runs it after hydration, and
          next/script de-dupes by src, so a page with two mounts loads it once.
          That ordering is what makes the SSR fallback above safe: React
          hydrates the server's links first, THEN embed.js replaces them. */}
      <Script src="/embed.js" strategy="afterInteractive" />
    </>
  );
}
