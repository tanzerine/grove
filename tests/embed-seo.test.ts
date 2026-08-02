/**
 * The embed's SEO state is one answer read by two surfaces — the dashboard
 * badge and the `blog_base` the API hands embed.js. They must never disagree:
 * a customer told "Indexable" whose cards still open a #fragment reader is
 * worse off than one told nothing, because they'll stop looking.
 */
import { describe, it, expect } from 'vitest';
import { embedSeoStatus, crawlableArticleUrl } from '@/lib/embed-seo';
import { blogPostUrl, canonicalBaseFor } from '@/lib/seo';

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

  it('treats grove’s own domain row as already indexable', () => {
    // The hash-only warning exists because /b/{slug} spends a customer's
    // content on grove's domain. When the domain IS grove's, that mirror is
    // on-domain: "credit goes to grove" is nonsense and the subdomain it tells
    // you to connect would buy nothing. This shipped reading "Not indexable"
    // on grove's own dashboard.
    const s = embedSeoStatus({ hostname: 'trygroveai.com', blog_slug: 'trygroveai-com-o6hf' }, HOSTED);
    expect(s.state).toBe('app-origin');
    expect(s.crawlable).toBe(true);
    expect(s.label).toBe('Indexable');
    expect(s.articleBase).toBe(`${HOSTED}/b/trygroveai-com-o6hf`);
    expect(s.fix).toBeNull();
    expect(s.detail).not.toContain('credit goes to grove');
  });

  it('matches the app origin through www and protocol', () => {
    for (const hostname of ['www.trygroveai.com', 'TryGroveAI.com']) {
      expect(embedSeoStatus({ hostname, blog_slug: 'x' }, HOSTED).state, hostname).toBe('app-origin');
    }
    // A different host that merely contains it is NOT the app origin.
    expect(embedSeoStatus({ hostname: 'nottrygroveai.com', blog_slug: 'x' }, HOSTED).state).toBe('hash-only');
  });

  it('still warns a real customer whose only copy is on grove’s domain', () => {
    const s = embedSeoStatus({ hostname: 'www.acme.com', blog_slug: 'acme-com-ab12' }, HOSTED);
    expect(s.state).toBe('hash-only');
    expect(s.fix).toContain('credit goes to grove');
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

/**
 * The list payload carries BOTH `blog_base` and a per-post `url`, built by two
 * different call sites. They have to describe the same place.
 *
 * REGRESSION (2026-08-02): the routes passed the raw `canonical_blog_base`
 * column into blogPostUrl instead of canonicalBaseFor(domain). A customer
 * whose canonical is a CNAME — custom_blog_hostname set, canonical_blog_base
 * NULL, which is exactly the live oveners.com configuration — got
 * `blog_base: https://blog.oveners.com` next to
 * `url: https://trygroveai.com/b/oveners-com-85lu/...` in one response. Every
 * article link the legacy feed and third-party API consumers drew pointed at
 * grove's mirror rather than the customer's own domain, sending the link
 * equity the product is sold on to the wrong host.
 */
describe('list payload — blog_base and per-post url agree', () => {
  const postUrlFor = (d: Parameters<typeof canonicalBaseFor>[0] & { blog_slug: string }) =>
    blogPostUrl(d.blog_slug, 'my-post', canonicalBaseFor(d));

  it('keeps the article under the CNAMEd base when canonical_blog_base is NULL', () => {
    const domain = {
      hostname: 'www.acme.com',
      blog_slug: 'acme-com-ab12',
      custom_blog_hostname: 'blog.acme.com',
      canonical_blog_base: null,
    };
    expect(postUrlFor(domain)).toBe('https://blog.acme.com/my-post');
    expect(postUrlFor(domain).startsWith(embedSeoStatus(domain, HOSTED).articleBase!)).toBe(true);
  });

  it('prefers an explicit canonical_blog_base over the CNAME', () => {
    const domain = {
      hostname: 'www.acme.com',
      blog_slug: 'acme-com-ab12',
      custom_blog_hostname: 'blog.acme.com',
      canonical_blog_base: 'https://acme.com/insights',
    };
    expect(postUrlFor(domain)).toBe('https://acme.com/insights/my-post');
    expect(postUrlFor(domain).startsWith(embedSeoStatus(domain, HOSTED).articleBase!)).toBe(true);
  });

  it('falls back to the grove mirror when the domain owns no base', () => {
    const domain = { hostname: 'www.acme.com', blog_slug: 'acme-com-ab12' };
    expect(postUrlFor(domain)).toContain('/b/acme-com-ab12/my-post');
    // Nothing crawlable on the customer's domain, so blog_base is null and the
    // mirror is all there is — the two are not in conflict here.
    expect(embedSeoStatus(domain, HOSTED).articleBase).toBeNull();
  });
});
