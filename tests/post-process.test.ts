import { describe, it, expect } from 'vitest';
import { forceCanonicalH1, capCitations, ensureHomepageCta } from '../lib/pipeline/post-process';

describe('forceCanonicalH1', () => {
  it('replaces a divergent H1 with the canonical title', () => {
    const out = forceCanonicalH1('# Wrong Headline\n\nBody text.', 'Right Title');
    expect(out).toMatch(/^# Right Title/);
    expect(out).not.toContain('Wrong Headline');
  });

  it('prepends an H1 when none exists', () => {
    const out = forceCanonicalH1('Just body text, no heading.', 'My Title');
    expect(out.startsWith('# My Title')).toBe(true);
  });

  it('demotes extra H1s to H2 so there is exactly one H1', () => {
    const out = forceCanonicalH1('# First\n\ntext\n\n# Second\n\nmore', 'Title');
    const h1s = out.split('\n').filter((l) => /^#\s+/.test(l));
    expect(h1s.length).toBe(1);
    expect(out).toContain('## Second');
  });
});

describe('capCitations', () => {
  it('keeps the first N links and demotes the rest to plain text', () => {
    const body = '[a](https://x.com/1) [b](https://x.com/2) [c](https://x.com/3)';
    const out = capCitations(body, 2);
    const remaining = (out.match(/\]\(https?:\/\//g) || []).length;
    expect(remaining).toBe(2);
    expect(out).toContain('c'); // text kept
    expect(out).not.toContain('https://x.com/3');
  });
});

describe('ensureHomepageCta', () => {
  it('is a no-op for editorial intent', () => {
    const body = 'An editorial piece that never mentions the brand by link.';
    expect(ensureHomepageCta(body, { businessName: 'Oven', hostname: 'oveners.com', intent: 'editorial' })).toBe(body);
  });

  it('inline-links the first brand mention for contextual intent', () => {
    const body = 'We built this the way Oven does it, carefully.';
    const out = ensureHomepageCta(body, { businessName: 'Oven', hostname: 'oveners.com', intent: 'contextual' });
    expect(out).toContain('[Oven](https://oveners.com)');
  });
});
