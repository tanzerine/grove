import { describe, it, expect } from 'vitest';
import { postProcess, forceCanonicalH1, capCitations, ensureHomepageCta } from '../lib/pipeline/post-process';

const SOURCES = [
  { url: 'https://s1.com', title: 't1', snippet: 'sn1' },
  { url: 'https://s2.com', title: 't2', snippet: 'sn2' },
] as any;

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

  // Stress run: the brand token inside code was being wrapped in a markdown
  // link — `import [Acme](https://acme.com) from "acme"` shipped broken code.
  it('never links a brand mention inside fenced or inline code', () => {
    const body = ['Prose without the brand.', '', '```js', 'Acme.init();', '```', '', 'Use `Acme.run()` today.'].join('\n');
    const out = ensureHomepageCta(body, { businessName: 'Acme', hostname: 'acme.com', intent: 'contextual' });
    expect(out).toBe(body);
  });

  it('still links the prose mention when code also mentions the brand', () => {
    const body = ['```js', 'Acme.init();', '```', '', 'We built Acme for this.'].join('\n');
    const out = ensureHomepageCta(body, { businessName: 'Acme', hostname: 'acme.com', intent: 'contextual' });
    expect(out).toContain('We built [Acme](https://acme.com) for this.');
    expect(out).toContain('Acme.init();');
  });
});

/* ── stress-run regressions: code must survive every mechanical pass ────── */

describe('postProcess code safety', () => {
  it('leaves array indexing, indentation and em-dashes in fenced code untouched', () => {
    const code = ['```python', 'def pick(items):', '    first = items[0]', '    second = items[1]', '    return first — second', '```'].join('\n');
    const md = `Intro — one — two — three dashes.\n\n${code}\n\nOutro.`;
    const out = postProcess(md, SOURCES);
    expect(out).toContain('    first = items[0]');
    expect(out).toContain('    second = items[1]');
    expect(out).toContain('return first — second'); // em-dash in code kept
    expect(out).toContain('Intro — one — two , three dashes.'); // prose cap still applies
  });

  it('leaves inline code spans untouched', () => {
    const out = postProcess('Call `items[1]` and `a  —  b` here.', SOURCES);
    expect(out).toContain('`items[1]`');
    expect(out).toContain('`a  —  b`');
  });

  it('does not dedupe repeated lines inside a fence', () => {
    const md = ['```js', 'run();', '', 'run();', '```'].join('\n');
    const out = postProcess(md, SOURCES);
    expect(out.match(/run\(\);/g)).toHaveLength(2);
  });

  it('still converts numeric refs to citation links in prose', () => {
    const out = postProcess('A claim [1] and another [2] and a dud [9].', SOURCES);
    expect(out).toContain('[(source)](https://s1.com)');
    expect(out).toContain('[(source)](https://s2.com)');
    expect(out).not.toContain('[9]');
  });

  it('keeps an existing numeric markdown link intact', () => {
    const out = postProcess('See [1](https://elsewhere.com) for detail.', SOURCES);
    expect(out).toContain('[1](https://elsewhere.com)');
  });

  it('preserves nested-list indentation in prose', () => {
    const md = '- parent\n  - child\n    - grandchild';
    expect(postProcess(md, SOURCES)).toBe(md);
  });
});

describe('postProcess banned phrases', () => {
  it('replaces whole words only — never inside larger words', () => {
    const out = postProcess('She delves deep. The robustness matters. He underscored it.', SOURCES);
    expect(out).toBe('She delves deep. The robustness matters. He underscored it.');
  });

  it('replaces the phrase itself, preserving sentence case', () => {
    const out = postProcess('Robust tools delve into problems.', SOURCES);
    expect(out).toBe('Solid tools cover problems.');
  });
});

describe('forceCanonicalH1 code safety', () => {
  it('does not demote # comments inside fenced code', () => {
    const md = ['# Old Title', '', 'Prose.', '', '```bash', '# install deps', 'npm i', '```', '', '# Stray H1'].join('\n');
    const out = forceCanonicalH1(md, 'Real Title');
    expect(out).toContain('# install deps');   // bash comment untouched
    expect(out).toContain('## Stray H1');      // real extra H1 still demoted
    expect(out.startsWith('# Real Title')).toBe(true);
  });
});
