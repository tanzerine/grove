/**
 * The embed's SEO state is one answer read by two surfaces — the dashboard
 * badge and the `blog_base` the API hands embed.js. They must never disagree:
 * a customer told "Indexable" whose cards still open a #fragment reader is
 * worse off than one told nothing, because they'll stop looking.
 */
import { describe, it, expect } from 'vitest';
import { embedSeoStatus, crawlableArticleUrl } from '@/lib/embed-seo';

const HOSTED = 'https://trygroveai.com';

describe('embedSeoStatus', () => {
  it('is hash-only — and says so — when nothing is configured', () => {
    const s = embedSeoStatus({ hostname: 'www.acme.com', blog_slug: 'acme-com-ab12' }, HOSTED);
    expect(s.state).toBe('hash-only');
    expect(s.crawlable).toBe(false);
    expect(s.articleBase).toBeNull();
    expect(s.label).toBe('Not indexable');
    // The fix has to name the mirror, or the customer can't tell where their
    // content currently lives while they decide.
    expect(s.fix).toContain(`${HOSTED}/b/acme-com-ab12`);
  });

  it('uses the CNAMEd subdomain as the article base', () => {
    const s = embedSeoStatus({
      hostname: 'www.acme.com',
      blog_slug: 'acme-com-ab12',
      custom_blog_hostname: 'blog.acme.com',
    }, HOSTED);
    expect(s.state).toBe('subdomain');
    expect(s.crawlable).toBe(true);
    expect(s.articleBase).toBe('https://blog.acme.com');
    expect(s.fix).toBeNull();
  });

  it('prefers a self-served canonical base over the subdomain', () => {
    // Both set is the reverse-proxy customer: grove still serves the subdomain,
    // but every emitted URL points at their own path — cards must follow the
    // canonical, or the embed links at a copy grove itself calls non-canonical.
    const s = embedSeoStatus({
      hostname: 'www.acme.com',
      blog_slug: 'acme-com-ab12',
      custom_blog_hostname: 'blog.acme.com',
      canonical_blog_base: 'https://www.acme.com/blog',
    }, HOSTED);
    expect(s.state).toBe('self-served');
    expect(s.articleBase).toBe('https://www.acme.com/blog');
  });

  it('ignores a blank canonical base instead of treating it as configured', () => {
    const s = embedSeoStatus({ hostname: 'acme.com', blog_slug: 'x', canonical_blog_base: '   ' }, HOSTED);
    expect(s.state).toBe('hash-only');
    expect(s.articleBase).toBeNull();
  });

  it('survives a null domain (dashboard renders before one is connected)', () => {
    const s = embedSeoStatus(null, HOSTED);
    expect(s.crawlable).toBe(false);
    expect(s.articleBase).toBeNull();
  });
});

describe('crawlableArticleUrl', () => {
  it('points at the customer base when there is one', () => {
    const url = crawlableArticleUrl(
      { hostname: 'www.acme.com', blog_slug: 'acme-com-ab12', custom_blog_hostname: 'blog.acme.com' },
      'my-post',
    );
    expect(url).toBe('https://blog.acme.com/my-post');
  });

  it('falls back to grove’s mirror rather than returning nothing', () => {
    // The hash reader injects this as rel=canonical. Declaring the mirror
    // canonical is imperfect; declaring nothing leaves a fragment URL claiming
    // itself, which is the outcome this whole path exists to avoid.
    const url = crawlableArticleUrl({ hostname: 'www.acme.com', blog_slug: 'acme-com-ab12' }, 'my-post');
    expect(url).toContain('/b/acme-com-ab12/my-post');
    expect(url.startsWith('http')).toBe(true);
  });
});
