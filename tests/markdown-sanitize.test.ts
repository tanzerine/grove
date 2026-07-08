import { describe, it, expect } from 'vitest';
import { mdToHtml, extractToc } from '../lib/markdown';

describe('mdToHtml sanitization', () => {
  it('strips <script> tags and their content', () => {
    const html = mdToHtml('Hello\n\n<script>alert(document.cookie)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
  });

  it('removes inline event handlers from raw HTML', () => {
    const html = mdToHtml('<img src=x onerror=alert(1)>');
    expect(html.toLowerCase()).not.toContain('onerror');
    // a raw <a onclick> must lose the handler too
    const a = mdToHtml('<a href="https://ok.test" onclick="steal()">hi</a>');
    expect(a.toLowerCase()).not.toContain('onclick');
  });

  it('drops javascript: hrefs but keeps the link text', () => {
    const html = mdToHtml('[click me](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('strips raw iframe/object embeds', () => {
    const html = mdToHtml('<iframe src="https://evil.test"></iframe>');
    expect(html.toLowerCase()).not.toContain('<iframe');
  });

  it('preserves safe formatting, links, and heading ids', () => {
    const html = mdToHtml('## Title\n\nSome **bold** and a [link](https://grove.so).');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://grove.so"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<h2 id="title"/);
  });

  it('keeps images with safe http(s) sources', () => {
    const html = mdToHtml('![alt text](https://cdn.test/pic.webp)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.test/pic.webp"');
    expect(html).toContain('alt="alt text"');
  });

  it('keeps task-list checkboxes but drops any other <input>', () => {
    const html = mdToHtml('hello <input type="text" value="x"> world\n\n- [x] done');
    expect(html).not.toContain('type="text"');
    expect(html).toContain('type="checkbox"');
  });
});

/* ── stress-run regressions: heading ids must be unique AND identical
      between the rendered HTML and the extracted ToC, or anchors dangle.
      Repeated headings are the norm in generated comparison posts
      ("Pros"/"Cons" per option). ─────────────────────────────────────── */

describe('heading id dedupe', () => {
  const md = [
    '# Top Picks',
    '## Option A', '### Pros', '### Cons',
    '## Option B', '### Pros', '### Cons',
  ].join('\n\n');

  it('suffixes duplicate ids in the rendered HTML', () => {
    const html = mdToHtml(md);
    expect(html).toContain('<h3 id="pros">');
    expect(html).toContain('<h3 id="pros-2">');
    expect(html).toContain('<h3 id="cons">');
    expect(html).toContain('<h3 id="cons-2">');
  });

  it('extractToc emits the exact ids the HTML renders', () => {
    const html = mdToHtml(md);
    for (const item of extractToc(md)) {
      expect(html).toContain(`id="${item.id}"`);
    }
    const ids = extractToc(md).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('stays aligned when an H1 shares text with an H2', () => {
    const both = '# Setup\n\n## Setup\n\n## Setup';
    const html = mdToHtml(both);
    const toc = extractToc(both);
    expect(toc.map((t) => t.id)).toEqual(['setup-2', 'setup-3']);
    for (const item of toc) expect(html).toContain(`id="${item.id}"`);
  });

  it('resets numbering between documents', () => {
    mdToHtml('## Pros');
    expect(mdToHtml('## Pros')).toContain('id="pros"'); // not pros-2
  });
});
