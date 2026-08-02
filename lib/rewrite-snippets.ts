/**
 * Reverse-proxy snippets: serve grove's blog from a PATH on the customer's own
 * domain (acme.com/blog/...) instead of a subdomain.
 *
 * Why this exists: the subdomain (custom_blog_hostname) is one DNS record and
 * gets ~all of the SEO, but a subdomain is still a distinct site to search
 * engines. A subfolder is the same origin, so every link the blog earns
 * compounds into the apex domain the customer actually sells from. The cost is
 * one config block in their host — no code, no build step, no CMS.
 *
 * The snippets are generated, never hand-copied, because all four have to agree
 * on the same three things: the article path, the sitemap path, and the blog
 * slug. A customer who proxies pages but not sitemap.xml ships a blog Google
 * can render and can't discover.
 *
 * Pair with canonical_blog_base = `https://{host}{path}` — the proxy makes the
 * URLs resolve, that column makes grove EMIT them.
 */

export type RewriteTarget = {
  key: 'vercel' | 'next' | 'netlify' | 'cloudflare';
  label: string;
  /** Where the customer puts it. */
  file: string;
  code: string;
};

export type RewriteOpts = {
  /** Grove's origin, e.g. https://trygroveai.com */
  groveBase: string;
  /** domains.blog_slug — the hosted blog's path segment on grove. */
  blogSlug: string;
  /** Path on the customer's site, default /blog. */
  path?: string;
  /** The customer's hostname, for the Cloudflare route pattern. */
  hostname?: string;
};

/** `/blog/` → `/blog`, `blog` → `/blog`, '' → `/blog`. */
export function normalizeMountPath(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return '/blog';
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * The files grove serves under /b/{slug} that MUST be proxied alongside the
 * pages, or the blog is invisible to crawlers (sitemap), to AI answer engines
 * (llms.txt), and to feed readers (rss.xml).
 */
export const PROXIED_FILES = ['sitemap.xml', 'rss.xml', 'robots.txt', 'llms.txt'] as const;

export function rewriteSnippets(opts: RewriteOpts): RewriteTarget[] {
  const base = opts.groveBase.replace(/\/$/, '');
  const slug = opts.blogSlug;
  const p = normalizeMountPath(opts.path);
  const origin = `${base}/b/${slug}`;
  const host = (opts.hostname ?? 'example.com').replace(/^www\./, '');

  const vercel = {
    rewrites: [
      { source: p, destination: origin },
      { source: `${p}/:path*`, destination: `${origin}/:path*` },
    ],
  };

  return [
    {
      key: 'vercel',
      label: 'Vercel',
      file: 'vercel.json',
      code: JSON.stringify(vercel, null, 2),
    },
    {
      key: 'next',
      label: 'Next.js',
      file: 'next.config.js',
      code: [
        'module.exports = {',
        '  async rewrites() {',
        '    return [',
        `      { source: '${p}', destination: '${origin}' },`,
        `      { source: '${p}/:path*', destination: '${origin}/:path*' },`,
        '    ]',
        '  },',
        '}',
      ].join('\n'),
    },
    {
      key: 'netlify',
      label: 'Netlify',
      file: 'netlify.toml',
      code: [
        '[[redirects]]',
        `  from = "${p}"`,
        `  to = "${origin}"`,
        '  status = 200',
        '',
        '[[redirects]]',
        `  from = "${p}/*"`,
        `  to = "${origin}/:splat"`,
        '  status = 200',
      ].join('\n'),
    },
    {
      key: 'cloudflare',
      label: 'Cloudflare',
      file: 'Worker (route: ' + host + p + '*)',
      code: [
        'export default {',
        '  async fetch(request) {',
        '    const url = new URL(request.url)',
        `    const rest = url.pathname.replace(/^${escapeRe(p)}/, '')`,
        `    const target = '${origin}' + rest + url.search`,
        '    return fetch(target, { headers: request.headers, redirect: "manual" })',
        '  },',
        '}',
      ].join('\n'),
    },
  ];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
