/**
 * The blog must never ship as an island again.
 *
 * A source-level guard, in the same spirit as tests/i18n-unwrapped.test.ts and
 * for the same reason: the property it protects is a property of the SOURCE,
 * this repo has no ESLint config, and `npm test` is the gate.
 *
 * What went wrong, measured rather than assumed. grove published 23 articles
 * to its own domain. `/blog` mounted embed.js into an empty `<div>`, so the
 * HTML a crawler received contained zero links to any of them; the homepage
 * had none either; and the hosted index paginated at 9, exposing 10 anchors
 * and leaving the rest behind a `?page=N` chain. Google's URL Inspection API
 * returned "Discovered – currently not indexed" for 9 of 24 sitemap URLs — it
 * had every URL and declined to spend crawl budget on pages nothing linked to.
 * Search Console recorded 11 impressions and 0 clicks for the whole blog in 90
 * days.
 *
 * Each assertion below is one of the three links in that chain. They are
 * deliberately shape-based rather than exact-match, so ordinary refactoring
 * does not trip them — but deleting the server-rendered links does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Files that mount the embed and therefore owe a crawlable fallback. */
const EMBED_SURFACES = ['app/blog/page.tsx', 'components/Landing.tsx'];

describe('the embed always ships a server-rendered fallback', () => {
  it.each(EMBED_SURFACES)('%s passes children to GroveEmbed', (file) => {
    const src = read(file);
    // A self-closing <GroveEmbed ... /> renders an empty container: embed.js
    // assigns root.innerHTML on mount, so whatever the server puts inside is
    // free, and an empty div is the defect this guard exists for.
    const selfClosing = /<GroveEmbed\b[^>]*\/>/.test(src);
    expect(
      selfClosing,
      `${file} mounts <GroveEmbed /> with no children. embed.js replaces the ` +
        `container's contents on mount, so server-rendered links inside it cost ` +
        `a reader nothing and are the only thing a crawler sees. Render the ` +
        `article links as children (see lib/grove-blog).`,
    ).toBe(false);
    expect(src).toMatch(/<GroveEmbed\b[\s\S]*?>[\s\S]*?<\/GroveEmbed>/);
  });

  it('/blog renders links for every published article', () => {
    const src = read('app/blog/page.tsx');
    expect(src).toContain('groveBlogLinks');
    // The list is rendered, not merely fetched.
    expect(src).toMatch(/entries\.map\(/);
  });

  it('the landing widget renders its links too', () => {
    expect(read('components/Landing.tsx')).toMatch(/blogLinks\.map\(/);
  });
});

describe('the hosted blog index links every article, for every customer', () => {
  const hub = read('app/b/[slug]/page.tsx');

  it('renders the full archive, not only the paginated slice', () => {
    expect(hub).toContain('archiveEntries');
    expect(hub).toMatch(/archive\.map\(/);
  });

  it('builds the archive from the UNFILTERED post list', () => {
    // `filtered` is narrowed by the search box and the genre chips. Building
    // the archive from it would delete the links exactly when a crawler
    // follows a chip — the archive must be the same on every view.
    expect(hub).toMatch(/archiveEntries\(\s*all\s*,/);
  });
});

describe('the root sitemap is an index', () => {
  it('emits a sitemapindex and carries the marketing child', () => {
    const src = read('app/sitemap.xml/route.ts');
    expect(src).toContain('buildSitemapIndexXml');
    expect(src).toContain('sitemapIndexChildren');
  });

  it('robots.txt and the sitemap index resolve the same blog set', () => {
    // Two copies of the bounded, fail-open scan would drift: robots.txt would
    // name a blog the index omitted, and neither would be wrong on its own.
    for (const f of ['app/robots.txt/route.ts', 'app/sitemap.xml/route.ts']) {
      expect(read(f), `${f} should resolve blogs via lib/advertised-blogs`).toContain(
        'advertisedBlogs',
      );
    }
  });
});
