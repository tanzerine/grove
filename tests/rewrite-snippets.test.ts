/**
 * A customer pastes ONE of these four blocks and never looks at the others, so
 * the contract is per-snippet: each must proxy the index, the articles, and the
 * discovery files. The failure this guards is silent — a config that serves
 * pages but not sitemap.xml renders a perfect blog that Google never finds.
 */
import { describe, it, expect } from 'vitest';
import { rewriteSnippets, normalizeMountPath } from '@/lib/rewrite-snippets';

const OPTS = { groveBase: 'https://trygroveai.com', blogSlug: 'acme-com-ab12', hostname: 'www.acme.com' };

describe('normalizeMountPath', () => {
  it('normalizes the shapes a customer actually types', () => {
    expect(normalizeMountPath('/blog')).toBe('/blog');
    expect(normalizeMountPath('blog')).toBe('/blog');
    expect(normalizeMountPath('/blog/')).toBe('/blog');
    expect(normalizeMountPath('  /articles/  ')).toBe('/articles');
    expect(normalizeMountPath('')).toBe('/blog');
    expect(normalizeMountPath(null)).toBe('/blog');
  });
});

describe('rewriteSnippets', () => {
  const targets = rewriteSnippets(OPTS);

  it('covers every platform once', () => {
    expect(targets.map((t) => t.key)).toEqual(['vercel', 'next', 'netlify', 'cloudflare']);
  });

  it('every snippet points at this domain’s hosted blog', () => {
    for (const t of targets) {
      expect(t.code, t.key).toContain('https://trygroveai.com/b/acme-com-ab12');
    }
  });

  it('every snippet carries the wildcard, not just the index', () => {
    // Without a wildcard the index proxies and every article 404s — and
    // sitemap.xml/rss.xml/llms.txt go with them.
    for (const t of targets) {
      const wild = /:path\*|\/\*|:splat|pathname/.test(t.code);
      expect(wild, `${t.key} has no wildcard rule`).toBe(true);
    }
  });

  it('proxies rather than redirects (the URL must stay on the customer’s domain)', () => {
    // A 301 to grove hands the pageview AND the search credit back to grove,
    // which is the entire thing this feature exists to prevent.
    const netlify = targets.find((t) => t.key === 'netlify')!;
    expect(netlify.code).toContain('status = 200');
    expect(netlify.code).not.toMatch(/status = 30[12]/);
  });

  it('emits valid JSON for the vercel target', () => {
    const vercel = targets.find((t) => t.key === 'vercel')!;
    const parsed = JSON.parse(vercel.code);
    expect(parsed.rewrites).toHaveLength(2);
    expect(parsed.rewrites[0].source).toBe('/blog');
    expect(parsed.rewrites[1].source).toBe('/blog/:path*');
    expect(parsed.rewrites[1].destination).toBe('https://trygroveai.com/b/acme-com-ab12/:path*');
  });

  it('threads a custom mount path through every platform', () => {
    for (const t of rewriteSnippets({ ...OPTS, path: 'insights/' })) {
      expect(t.code, t.key).toContain('/insights');
      expect(t.code, t.key).not.toContain('/blog');
    }
  });

  it('escapes the path in the Cloudflare regex', () => {
    // '/blog.new' unescaped makes '.' match any char — the worker would then
    // strip a prefix off paths it was never meant to touch.
    const cf = rewriteSnippets({ ...OPTS, path: '/blog.new' }).find((t) => t.key === 'cloudflare')!;
    expect(cf.code).toContain('/blog\\.new');
  });

  it('strips www from the Cloudflare route hint', () => {
    const cf = rewriteSnippets(OPTS).find((t) => t.key === 'cloudflare')!;
    expect(cf.file).toContain('acme.com/blog');
    expect(cf.file).not.toContain('www.');
  });
});
