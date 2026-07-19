import { describe, it, expect } from 'vitest';
import { rewriteImgsToCdn } from '../lib/image-cdn';

const SB = 'https://lojgijnjagaozrrpjlbj.supabase.co/storage/v1/object/public/post-covers/abc.webp';

describe('rewriteImgsToCdn', () => {
  it('rewrites a Supabase storage img src to /_next/image', () => {
    const html = `<p>hi</p><img src="${SB}" alt="cover">`;
    const out = rewriteImgsToCdn(html);
    expect(out).toContain(`src="/_next/image?url=${encodeURIComponent(SB)}&amp;w=1200&amp;q=75"`);
    expect(out).not.toContain(`src="${SB}"`);
  });

  it('rewrites every Supabase img, not just the first', () => {
    const other = SB.replace('abc', 'def');
    const out = rewriteImgsToCdn(`<img src="${SB}"><img src="${other}">`);
    expect(out.match(/\/_next\/image\?url=/g)).toHaveLength(2);
  });

  it('leaves non-Supabase images untouched', () => {
    const html = '<img src="https://example.com/pic.png"><img src="/local.svg">';
    expect(rewriteImgsToCdn(html)).toBe(html);
  });

  it('leaves Supabase URLs outside storage public paths untouched', () => {
    const html = '<img src="https://x.supabase.co/auth/v1/thing.png">';
    expect(rewriteImgsToCdn(html)).toBe(html);
  });

  it('keeps other img attributes intact', () => {
    const out = rewriteImgsToCdn(`<img loading="lazy" src="${SB}" alt="a cover">`);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('alt="a cover"');
  });

  it('honors width/quality overrides', () => {
    const out = rewriteImgsToCdn(`<img src="${SB}">`, { width: 828, quality: 60 });
    expect(out).toContain('&amp;w=828&amp;q=60');
  });

  it('passes through empty/absent html', () => {
    expect(rewriteImgsToCdn('')).toBe('');
    expect(rewriteImgsToCdn('<p>no images</p>')).toBe('<p>no images</p>');
  });
});
