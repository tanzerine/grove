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
      />
      {/* A customer drops in a plain `<script async src=".../embed.js">`, which
          is right on a normal page. Here it is NOT: a bare async script can win
          the race against hydration, and React then deletes the children it
          finds in a div it rendered empty — the embed mounts and is wiped
          milliseconds later. `afterInteractive` runs it after hydration, and
          next/script de-dupes by src, so a page with two mounts loads it once. */}
      <Script src="/embed.js" strategy="afterInteractive" />
    </>
  );
}
