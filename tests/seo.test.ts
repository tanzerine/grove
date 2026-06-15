import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  escapeXml, isBot, jsonLdScript, appBase,
  blogHomeUrl, blogPostUrl, subdomainSlugFromHost, buildLlmsTxt, buildArticleGraph, buildSitemapXml,
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
