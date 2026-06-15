import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  escapeXml, isBot, jsonLdScript, appBase,
  blogHomeUrl, blogPostUrl, subdomainSlugFromHost, buildLlmsTxt,
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
