import { describe, it, expect } from 'vitest';
import { postProcess, forceCanonicalH1, capCitations, ensureHomepageCta, ensureTakeaways, ensureFaqSection } from '../lib/pipeline/post-process';

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
    expect(out).toContain('Intro — one — two, three dashes.'); // prose cap still applies
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
    expect(out).toContain('[s1.com](https://s1.com)');
    expect(out).toContain('[s2.com](https://s2.com)');
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

describe('citation artifacts', () => {
  it('numeric refs become domain-labelled links, not "(source)"', () => {
    const out = postProcess('A claim [1] and another [2].', [
      { url: 'https://www.adobe.com/guide', title: 't1', snippet: 's' },
      { url: 'https://helpx.adobe.com/x', title: 't2', snippet: 's' },
    ] as any);
    expect(out).toContain('[adobe.com](https://www.adobe.com/guide)');
    expect(out).not.toContain('(source)');
  });

  it('strips literal "(source)" placeholders the model emits itself', () => {
    const out = postProcess('Inflate flat vectors (source). Also [(source)] and [source] junk.', []);
    expect(out).not.toMatch(/\(source\)|\[source\]/i);
    expect(out).toContain('Inflate flat vectors.');
  });

  it('keeps a real [(source)](url) link intact', () => {
    const out = postProcess('A cited claim [(source)](https://x.com/a).', []);
    expect(out).toContain('[(source)](https://x.com/a)');
  });

  it('capCitations drops artifact link text instead of leaving "(source)" prose', () => {
    const body =
      '[a](https://x.com/1) [b](https://x.com/2) claim [(source)](https://x.com/3) and [adobe.com](https://x.com/4)';
    const out = capCitations(body, 2);
    expect(out).not.toContain('(source)');
    expect(out).not.toContain('adobe.com');
    expect(out).toContain('claim and');
  });
});

describe('ensureTakeaways', () => {
  const section = '- Paper filters trap oils\n- Grind size decides bitterness\n- Water at 93°C';

  it('inserts the block before the first H2 when the body has none', () => {
    const out = ensureTakeaways('# T\n\nIntro para.\n\n## First section\n\nBody.', section);
    expect(out.indexOf('**Key takeaways**')).toBeGreaterThan(-1);
    expect(out.indexOf('**Key takeaways**')).toBeLessThan(out.indexOf('## First section'));
    expect(out).toContain('- Paper filters trap oils');
  });

  it('no-ops when the body already has a takeaways block', () => {
    const body = '# T\n\n**Key takeaways**\n\n- one\n- two\n\n## S\n\nBody.';
    expect(ensureTakeaways(body, section)).toBe(body);
  });

  it('no-ops when the section has fewer than 2 bullets', () => {
    const body = '# T\n\nIntro.\n\n## S\n\nBody.';
    expect(ensureTakeaways(body, '- only one')).toBe(body);
  });
});

describe('ensureFaqSection', () => {
  const section = '### Is it free?\n\nYes, within limits that matter.\n\n### Does it export SVG?\n\nIt does, plus PNG and WEBP.';

  it('appends a parseable ## FAQ when the body lacks one', () => {
    const out = ensureFaqSection('# T\n\nBody text.', section);
    expect(out).toContain('## FAQ');
    expect(out).toContain('### Is it free?');
  });

  it('no-ops when the body already has a FAQ', () => {
    const body = '# T\n\nBody.\n\n## FAQ\n\n### Q?\n\nAnswer here.';
    expect(ensureFaqSection(body, section)).toBe(body);
  });

  it('drops a section that does not parse into Q&As', () => {
    const body = '# T\n\nBody.';
    expect(ensureFaqSection(body, 'just some prose, no headings')).toBe(body);
  });

  it('normalizes a repeated "## FAQ" heading inside the section', () => {
    const out = ensureFaqSection('# T\n\nBody.', `## FAQ\n${section}`);
    expect(out.match(/## FAQ/g)?.length).toBe(1);
  });
});
