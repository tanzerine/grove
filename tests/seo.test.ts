import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  escapeXml, isBot, jsonLdScript, appBase, normalizeCanonicalBase,
  blogHomeUrl, blogPostUrl, subdomainSlugFromHost, buildLlmsTxt, buildArticleGraph, buildSitemapXml, buildRssXml,
  sanitizeEmbedHost, normalizeBlogHostname, canonicalBaseFor, servedBlogBaseFor, isCustomBlogHost,
} from '../lib/seo';

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });
  it('passes plain text through unchanged', () => {
    expect(escapeXml('hello world 한국어 123')).toBe('hello world 한국어 123');
  });
});

describe('isBot', () => {
  it('flags common crawlers and preview fetchers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('facebookexternalhit/1.1')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBe(true);
    expect(isBot('GPTBot/1.0')).toBe(true);
  });
  it('passes real browsers', () => {
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')).toBe(false);
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe(false);
  });
  it('treats missing UA as not-bot', () => {
    expect(isBot(null)).toBe(false);
    expect(isBot(undefined)).toBe(false);
    expect(isBot('')).toBe(false);
  });
});

describe('jsonLdScript', () => {
  it('escapes < so titles cannot break out of the script tag', () => {
    const out = jsonLdScript({ headline: 'x</script><script>alert(1)' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out.replace(/\\u003c/g, '<'))).toEqual({ headline: 'x</script><script>alert(1)' });
  });
});

describe('appBase', () => {
  it('returns an origin without a trailing slash', () => {
    expect(appBase().endsWith('/')).toBe(false);
    expect(appBase()).toMatch(/^https?:\/\//);
  });
});

describe('blog URLs', () => {
  const saved = process.env.GROVE_BLOG_ROOT_DOMAIN;
  beforeEach(() => { delete process.env.GROVE_BLOG_ROOT_DOMAIN; });
  afterEach(() => {
    if (saved === undefined) delete process.env.GROVE_BLOG_ROOT_DOMAIN;
    else process.env.GROVE_BLOG_ROOT_DOMAIN = saved;
  });

  it('path mode (env unset): blogs live under /b on the app origin', () => {
    expect(blogHomeUrl('demo')).toBe(`${appBase()}/b/demo`);
    expect(blogPostUrl('demo', 'my-post')).toBe(`${appBase()}/b/demo/my-post`);
  });

  it('subdomain mode: blogs live on {slug}.{root}', () => {
    process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
    expect(blogHomeUrl('demo')).toBe('https://demo.grove.so');
    expect(blogPostUrl('demo', 'my-post')).toBe('https://demo.grove.so/my-post');
  });

  it('tolerates scheme/trailing-slash in the env value', () => {
    process.env.GROVE_BLOG_ROOT_DOMAIN = 'https://grove.so/';
    expect(blogHomeUrl('demo')).toBe('https://demo.grove.so');
  });

  it('canonical base wins over both path and subdomain modes', () => {
    expect(blogHomeUrl('demo', 'https://acme.com/blog')).toBe('https://acme.com/blog');
    expect(blogPostUrl('demo', 'my-post', 'https://acme.com/blog')).toBe('https://acme.com/blog/my-post');
    process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
    expect(blogPostUrl('demo', 'my-post', 'https://acme.com/blog')).toBe('https://acme.com/blog/my-post');
  });

  it('null/invalid canonical base falls back to grove-hosted URLs', () => {
    expect(blogHomeUrl('demo', null)).toBe(`${appBase()}/b/demo`);
    expect(blogHomeUrl('demo', '   ')).toBe(`${appBase()}/b/demo`);
    expect(blogHomeUrl('demo', 'not a url')).toBe(`${appBase()}/b/demo`);
  });
});

describe('normalizeCanonicalBase', () => {
  it('strips trailing slashes and keeps the path', () => {
    expect(normalizeCanonicalBase('https://acme.com/blog/')).toBe('https://acme.com/blog');
    expect(normalizeCanonicalBase('https://acme.com/')).toBe('https://acme.com');
  });

  it('adds https:// when the scheme is missing', () => {
    expect(normalizeCanonicalBase('acme.com/blog')).toBe('https://acme.com/blog');
  });

  it('rejects garbage, empty, and non-dotted hosts', () => {
    expect(normalizeCanonicalBase('')).toBeNull();
    expect(normalizeCanonicalBase(null)).toBeNull();
    expect(normalizeCanonicalBase('   ')).toBeNull();
    expect(normalizeCanonicalBase('localhost/blog')).toBeNull();
    expect(normalizeCanonicalBase('ftp://acme.com')).toBeNull();
  });
});

describe('buildLlmsTxt', () => {
  const posts = [
    { slug: 'a', title: 'First Post', meta_description: 'About the first thing.' },
    { slug: 'b', title: 'Second Post', meta_description: null },
    { slug: null, title: 'No slug', meta_description: 'skip me' },
    { slug: 'c', title: null, meta_description: 'skip me too' },
  ];

  it('emits an llmstxt.org-shaped index with a title, summary, and article links', () => {
    const out = buildLlmsTxt({ hostname: 'acme.com', blogSlug: 'demo', description: 'We make widgets.', posts });
    expect(out.startsWith('# acme.com\n')).toBe(true);
    expect(out).toContain('> We make widgets.');
    expect(out).toContain('## Articles');
    expect(out).toContain(`- [First Post](${blogPostUrl('demo', 'a')}): About the first thing.`);
    // no description → no trailing colon segment
    expect(out).toContain(`- [Second Post](${blogPostUrl('demo', 'b')})\n`);
    expect(out).toContain(`- [acme.com blog](${blogHomeUrl('demo')})`);
  });

  it('skips posts missing a slug or title', () => {
    const out = buildLlmsTxt({ hostname: 'acme.com', blogSlug: 'demo', description: '', posts });
    expect(out).not.toContain('No slug');
    expect(out).not.toContain('skip me too');
  });

  it('falls back to a generated summary when no description is given', () => {
    const out = buildLlmsTxt({ hostname: 'acme.com', blogSlug: 'demo', description: null, posts: [] });
    expect(out).toContain('> Articles and guides from acme.com.');
  });

  it('neutralizes brackets in titles so link syntax cannot break', () => {
    const out = buildLlmsTxt({
      hostname: 'acme.com', blogSlug: 'demo', description: 'x',
      posts: [{ slug: 'a', title: 'Use [brackets] here', meta_description: '' }],
    });
    expect(out).toContain('- [Use brackets here]');
  });
});

describe('buildSitemapXml', () => {
  const posts = [
    { slug: 'newest', published_at: '2026-06-10T12:00:00Z', cover_image_url: 'https://img/c.webp' },
    { slug: 'older', published_at: '2026-05-01T00:00:00Z', cover_image_url: null },
    { slug: null, published_at: '2026-04-01T00:00:00Z', cover_image_url: null },
  ];

  it('lists the home + every slugged post with a date-only lastmod', () => {
    const xml = buildSitemapXml({ blogSlug: 'demo', posts });
    expect(xml).toContain('<urlset');
    expect(xml).toContain(`<loc>${blogHomeUrl('demo')}</loc>`);
    expect(xml).toContain(`<loc>${blogPostUrl('demo', 'newest')}</loc><lastmod>2026-06-10</lastmod>`);
    expect(xml).toContain(`<loc>${blogPostUrl('demo', 'older')}</loc><lastmod>2026-05-01</lastmod>`);
    // index lastmod tracks the newest post
    expect(xml).toContain(`<loc>${blogHomeUrl('demo')}</loc><lastmod>2026-06-10</lastmod>`);
  });

  it('emits the image extension only for posts with a cover', () => {
    const xml = buildSitemapXml({ blogSlug: 'demo', posts });
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain('<image:loc>https://img/c.webp</image:loc>');
    // the cover-less post has no <image:image>
    const olderUrl = xml.slice(xml.indexOf(`<loc>${blogPostUrl('demo', 'older')}`));
    expect(olderUrl.slice(0, olderUrl.indexOf('</url>'))).not.toContain('<image:image>');
  });

  it('skips posts with no slug and escapes URLs', () => {
    const xml = buildSitemapXml({
      blogSlug: 'demo',
      posts: [{ slug: 'a&b', published_at: null, cover_image_url: null }, ...posts],
    });
    expect(xml).not.toMatch(/<loc>[^<]*null/);
    expect(xml).toContain('a&amp;b');
  });

  // An in-place refresh keeps published_at (first publication) and moves
  // updated_at, so lastmod has to follow updated_at or a rewritten article
  // looks unchanged to every crawler that reads the sitemap.
  it('prefers updated_at over published_at for lastmod', () => {
    const xml = buildSitemapXml({
      blogSlug: 'demo',
      posts: [{ slug: 'refreshed', published_at: '2026-01-05T00:00:00Z', updated_at: '2026-07-20T00:00:00Z', cover_image_url: null }],
    });
    expect(xml).toContain(`<loc>${blogPostUrl('demo', 'refreshed')}</loc><lastmod>2026-07-20</lastmod>`);
  });

  it('falls back to published_at when updated_at is absent or null', () => {
    const nulled = buildSitemapXml({
      blogSlug: 'demo',
      posts: [{ slug: 'plain', published_at: '2026-01-05T00:00:00Z', updated_at: null, cover_image_url: null }],
    });
    // `posts` above omits updated_at entirely — the pre-0032 shape.
    const absent = buildSitemapXml({ blogSlug: 'demo', posts });
    expect(nulled).toContain('<lastmod>2026-01-05</lastmod>');
    expect(absent).toContain(`<loc>${blogPostUrl('demo', 'newest')}</loc><lastmod>2026-06-10</lastmod>`);
  });

  it('index lastmod tracks the most recently CHANGED post, not the newest one', () => {
    // The refreshed post is the OLDEST by published_at, so a "first row wins"
    // index lastmod would report June and miss the July rewrite entirely.
    const xml = buildSitemapXml({
      blogSlug: 'demo',
      posts: [...posts, { slug: 'ancient', published_at: '2026-01-01T00:00:00Z', updated_at: '2026-07-20T00:00:00Z', cover_image_url: null }],
    });
    expect(xml).toContain(`<loc>${blogHomeUrl('demo')}</loc><lastmod>2026-07-20</lastmod>`);
  });
});

describe('buildRssXml', () => {
  const items = [
    {
      slug: 'newest', title: 'Newest', description: 'desc one',
      publishedAt: '2026-06-10T12:00:00Z', coverUrl: 'https://img/c.webp',
      contentHtml: '<p>Full body</p>', category: 'Guides', author: 'Acme Team',
    },
    { slug: null, title: 'No slug', publishedAt: '2026-07-01T00:00:00Z' },
  ];

  it('renders a channel with enriched items (content, creator, category)', () => {
    const xml = buildRssXml({ hostname: 'acme.com', blogSlug: 'demo', items });
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
    expect(xml).toContain('<title>The acme.com blog</title>');
    expect(xml).toContain(`<link>${blogPostUrl('demo', 'newest')}</link>`);
    expect(xml).toContain('<dc:creator>Acme Team</dc:creator>');
    expect(xml).toContain('<category>Guides</category>');
    expect(xml).toContain('<content:encoded><![CDATA[<p>Full body</p>]]></content:encoded>');
    expect(xml).toContain('<pubDate>Wed, 10 Jun 2026 12:00:00 GMT</pubDate>');
  });

  it('skips slugless items and dates the build from the first (newest) item', () => {
    const xml = buildRssXml({ hostname: 'acme.com', blogSlug: 'demo', items });
    expect(xml).not.toContain('No slug');
    // feed contract is newest-first, so lastBuildDate is the first item's date
    expect(xml).toContain('<lastBuildDate>Wed, 10 Jun 2026 12:00:00 GMT</lastBuildDate>');
  });

  it('keeps CDATA intact when content contains a "]]>" sequence', () => {
    const xml = buildRssXml({
      hostname: 'a', blogSlug: 'demo',
      items: [{ slug: 'x', title: 'X', contentHtml: 'before ]]> after', publishedAt: '2026-01-01T00:00:00Z' }],
    });
    expect(xml).toContain(']]]]><![CDATA[>');
    expect(xml).not.toMatch(/CDATA\[[^]]*]]> after/);
  });
});

describe('buildArticleGraph', () => {
  const base = {
    hostname: 'acme.com', blogSlug: 'demo', postSlug: 'my-post',
    title: 'My Post', description: 'A description.', image: 'https://img/c.webp',
    publishedAt: '2026-06-15T00:00:00Z', businessName: 'Acme', homeUrl: 'https://acme.com',
    authorName: 'Acme Team', authorIsOrg: true, genreLabel: 'Guides', wordCount: 1200,
  };
  const find = (g: any, type: string) => g['@graph'].find((n: any) => n['@type'] === type);

  it('builds a @graph with the core linked nodes', () => {
    const g = buildArticleGraph(base);
    expect(g['@context']).toBe('https://schema.org');
    for (const t of ['Organization', 'WebSite', 'WebPage', 'BlogPosting', 'BreadcrumbList']) {
      expect(find(g, t)).toBeTruthy();
    }
  });

  it('cross-references nodes by @id', () => {
    const g = buildArticleGraph(base);
    const org = find(g, 'Organization'), site = find(g, 'WebSite');
    const page = find(g, 'WebPage'), article = find(g, 'BlogPosting');
    expect(site.publisher['@id']).toBe(org['@id']);
    expect(page.isPartOf['@id']).toBe(site['@id']);
    expect(article.isPartOf['@id']).toBe(page['@id']);
    expect(article.mainEntityOfPage['@id']).toBe(page['@id']);
    expect(article.publisher['@id']).toBe(org['@id']);
    expect(article.wordCount).toBe(1200);
    expect(article.inLanguage).toBe('en');
  });

  it('exposes a SearchAction pointing at the blog search', () => {
    const site = find(buildArticleGraph(base), 'WebSite');
    expect(site.potentialAction['@type']).toBe('SearchAction');
    expect(site.potentialAction.target.urlTemplate).toBe(`${blogHomeUrl('demo')}?q={search_term_string}`);
  });

  // datePublished must keep pointing at first publication — a refreshed
  // article that claims to be brand new loses the age signal it earned.
  it('moves dateModified to updatedAt but leaves datePublished alone', () => {
    const g = buildArticleGraph({ ...base, updatedAt: '2026-07-20T00:00:00Z' });
    const article = find(g, 'BlogPosting');
    expect(article.datePublished).toBe('2026-06-15T00:00:00Z');
    expect(article.dateModified).toBe('2026-07-20T00:00:00Z');
  });

  it('falls back to publishedAt for dateModified when never refreshed', () => {
    const article = find(buildArticleGraph(base), 'BlogPosting');
    expect(article.dateModified).toBe('2026-06-15T00:00:00Z');
  });

  it('marks a Team author as Organization, a person as Person', () => {
    expect(find(buildArticleGraph(base), 'BlogPosting').author['@type']).toBe('Organization');
    const personGraph = buildArticleGraph({ ...base, authorName: 'Jane Roe', authorIsOrg: false });
    expect(find(personGraph, 'BlogPosting').author['@type']).toBe('Person');
  });

  it('includes FAQPage only when there are >= 2 pairs', () => {
    expect(find(buildArticleGraph(base), 'FAQPage')).toBeFalsy();
    const withFaq = buildArticleGraph({
      ...base, faqs: [{ question: 'Q1?', answer: 'A1.' }, { question: 'Q2?', answer: 'A2.' }],
    });
    const faq = find(withFaq, 'FAQPage');
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('A1.');
  });
});

describe('canonical base threading (equity goes to the customer domain)', () => {
  const BASE = 'https://acme.com/blog';

  it('sitemap <loc> entries point at the customer domain', () => {
    const xml = buildSitemapXml({
      blogSlug: 'demo', canonicalBase: BASE,
      posts: [{ slug: 'a', published_at: '2026-06-10T12:00:00Z', cover_image_url: null }],
    });
    expect(xml).toContain('<loc>https://acme.com/blog</loc>');
    expect(xml).toContain('<loc>https://acme.com/blog/a</loc>');
    expect(xml).not.toContain('/b/demo');
  });

  it('RSS links point at the customer domain but the self-link stays at the feed location', () => {
    const xml = buildRssXml({
      hostname: 'acme.com', blogSlug: 'demo', canonicalBase: BASE,
      items: [{ slug: 'a', title: 'A', publishedAt: '2026-06-10T12:00:00Z' }],
    });
    expect(xml).toContain('<link>https://acme.com/blog/a</link>');
    expect(xml).toContain(`href="${blogHomeUrl('demo')}/rss.xml"`);
  });

  it('JSON-LD page/article ids live on the customer domain', () => {
    const g = buildArticleGraph({
      hostname: 'acme.com', blogSlug: 'demo', postSlug: 'a', title: 'A',
      businessName: 'Acme', homeUrl: 'https://acme.com', authorName: 'Acme Team',
      authorIsOrg: true, genreLabel: 'Guides', wordCount: 900, canonicalBase: BASE,
    });
    const page: any = g['@graph'].find((n: any) => n['@type'] === 'WebPage');
    expect(page.url).toBe('https://acme.com/blog/a');
  });

  it('llms.txt article links point at the customer domain', () => {
    const out = buildLlmsTxt({
      hostname: 'acme.com', blogSlug: 'demo', canonicalBase: BASE, description: 'x',
      posts: [{ slug: 'a', title: 'A', meta_description: '' }],
    });
    expect(out).toContain('(https://acme.com/blog/a)');
  });
});

describe('subdomainSlugFromHost', () => {
  const saved = process.env.GROVE_BLOG_ROOT_DOMAIN;
  beforeEach(() => { process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so'; });
  afterEach(() => {
    if (saved === undefined) delete process.env.GROVE_BLOG_ROOT_DOMAIN;
    else process.env.GROVE_BLOG_ROOT_DOMAIN = saved;
  });

  it('extracts the slug from a blog subdomain (port ignored)', () => {
    expect(subdomainSlugFromHost('demo.grove.so')).toBe('demo');
    expect(subdomainSlugFromHost('demo.grove.so:443')).toBe('demo');
    expect(subdomainSlugFromHost('My-Blog.GROVE.SO')).toBe('my-blog');
  });

  it('ignores the root, www, foreign hosts, and nested subdomains', () => {
    expect(subdomainSlugFromHost('grove.so')).toBeNull();
    expect(subdomainSlugFromHost('www.grove.so')).toBeNull();
    expect(subdomainSlugFromHost('evil.com')).toBeNull();
    expect(subdomainSlugFromHost('notgrove.so')).toBeNull();
    expect(subdomainSlugFromHost('a.b.grove.so')).toBeNull(); // dot in slug → invalid
  });

  it('is a no-op when the env is unset', () => {
    delete process.env.GROVE_BLOG_ROOT_DOMAIN;
    expect(subdomainSlugFromHost('demo.grove.so')).toBeNull();
  });

  it('handles null/empty hosts', () => {
    expect(subdomainSlugFromHost(null)).toBeNull();
    expect(subdomainSlugFromHost('')).toBeNull();
  });
});

describe('sanitizeEmbedHost', () => {
  it('normalizes the common variants', () => {
    expect(sanitizeEmbedHost('oveners.com')).toBe('oveners.com');
    expect(sanitizeEmbedHost('WWW.Oveners.COM')).toBe('www.oveners.com');
    expect(sanitizeEmbedHost('https%3A%2F%2Foveners.com%2F')).toBe('oveners.com');
    expect(sanitizeEmbedHost('oveners.com:3000')).toBe('oveners.com');
  });

  // Stress run: malformed percent-encoding made decodeURIComponent throw — a
  // 500 on a public endpoint.
  it('returns null instead of throwing on malformed encoding', () => {
    expect(sanitizeEmbedHost('%zz')).toBeNull();
    expect(sanitizeEmbedHost('%')).toBeNull();
  });

  // The value is interpolated into a PostgREST .or() filter — commas/parens
  // would inject extra filter conditions.
  it('rejects PostgREST filter metacharacters', () => {
    expect(sanitizeEmbedHost('x.com,id.not.is.null')).toBeNull();
    expect(sanitizeEmbedHost('x.com)')).toBeNull();
    expect(sanitizeEmbedHost('a b.com')).toBeNull();
    expect(sanitizeEmbedHost('')).toBeNull();
    expect(sanitizeEmbedHost(null)).toBeNull();
  });
});

describe('buildRssXml date safety', () => {
  it('omits pubDate for unparseable timestamps instead of emitting "Invalid Date"', () => {
    const xml = buildRssXml({
      hostname: 'x.com', blogSlug: 'x',
      items: [
        { slug: 'a', title: 'A', publishedAt: 'not-a-date' },
        { slug: 'b', title: 'B', publishedAt: '2026-07-01T09:00:00.000Z' },
      ],
    });
    expect(xml).not.toContain('Invalid Date');
    expect(xml).toContain('<pubDate>Wed, 01 Jul 2026 09:00:00 GMT</pubDate>');
  });
});

describe('normalizeBlogHostname', () => {
  it('accepts a bare hostname and lowercases it', () => {
    expect(normalizeBlogHostname('Blog.Example.com')).toBe('blog.example.com');
  });
  it('strips scheme, trailing slash, and port', () => {
    expect(normalizeBlogHostname('https://blog.example.com/')).toBe('blog.example.com');
    expect(normalizeBlogHostname('blog.example.com:443')).toBe('blog.example.com');
  });
  it('rejects paths, single labels, bad chars, and empties', () => {
    expect(normalizeBlogHostname('blog.example.com/path')).toBeNull();
    expect(normalizeBlogHostname('localhost')).toBeNull();
    expect(normalizeBlogHostname('blog')).toBeNull();
    expect(normalizeBlogHostname('-bad.example.com')).toBeNull();
    expect(normalizeBlogHostname('exa mple.com')).toBeNull();
    expect(normalizeBlogHostname('under_score.example.com')).toBeNull();
    expect(normalizeBlogHostname('')).toBeNull();
    expect(normalizeBlogHostname(null)).toBeNull();
    expect(normalizeBlogHostname(undefined)).toBeNull();
  });
});

describe('canonicalBaseFor', () => {
  it('is null with neither customer surface configured', () => {
    expect(canonicalBaseFor(null)).toBeNull();
    expect(canonicalBaseFor({})).toBeNull();
    expect(canonicalBaseFor({ canonical_blog_base: null, custom_blog_hostname: null })).toBeNull();
  });
  it('uses the CNAME hostname when only it is set', () => {
    expect(canonicalBaseFor({ custom_blog_hostname: 'blog.example.com' })).toBe('https://blog.example.com');
  });
  it('prefers a self-served canonical base over the CNAME hostname', () => {
    expect(canonicalBaseFor({
      canonical_blog_base: 'https://www.example.com/blog',
      custom_blog_hostname: 'blog.example.com',
    })).toBe('https://www.example.com/blog');
  });
  it('falls through to the hostname when the canonical base is garbage', () => {
    expect(canonicalBaseFor({
      canonical_blog_base: 'nope',
      custom_blog_hostname: 'blog.example.com',
    })).toBe('https://blog.example.com');
  });
  it('composes with the URL builders', () => {
    const d = { custom_blog_hostname: 'blog.example.com' };
    expect(blogPostUrl('slug-x', 'my-post', canonicalBaseFor(d))).toBe('https://blog.example.com/my-post');
  });
});

describe('servedBlogBaseFor', () => {
  it('only ever returns the CNAME hostname — never a customer-rendered base', () => {
    expect(servedBlogBaseFor({ canonical_blog_base: 'https://www.example.com/blog' })).toBeNull();
    expect(servedBlogBaseFor({
      canonical_blog_base: 'https://www.example.com/blog',
      custom_blog_hostname: 'blog.example.com',
    })).toBe('https://blog.example.com');
    expect(servedBlogBaseFor(null)).toBeNull();
  });
});

describe('isCustomBlogHost', () => {
  const domain = { custom_blog_hostname: 'blog.example.com' };
  it('matches the Host header against the configured hostname', () => {
    expect(isCustomBlogHost('blog.example.com', domain)).toBe(true);
    expect(isCustomBlogHost('Blog.Example.com:443', domain)).toBe(true);
  });
  it('rejects other hosts and unconfigured domains', () => {
    expect(isCustomBlogHost('www.example.com', domain)).toBe(false);
    expect(isCustomBlogHost('blog.example.com', {})).toBe(false);
    expect(isCustomBlogHost(null, domain)).toBe(false);
  });
});
