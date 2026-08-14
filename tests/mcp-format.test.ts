/**
 * The files grove writes into someone else's repository.
 *
 * Two things here have consequences a long way from this module:
 *
 * 1. THE CHECKSUM decides whether a re-sync notices an edit. It hashes the
 *    BODY rather than timestamps, because posts.updated_at is only written by
 *    an in-place refresh — a checksum built on metadata would call an edited
 *    article current forever, and the customer's site would keep serving the
 *    old copy with nothing anywhere saying so.
 *
 * 2. MDX ESCAPING decides whether their build passes. A brace in prose is a
 *    JS expression to an MDX compiler and an angle bracket is JSX; either one
 *    fails the deploy, on an article nobody was looking at.
 */
import { describe, it, expect } from 'vitest';
import {
  articleChecksum, yamlFrontmatter, articleFrontmatter, escapeMdx,
  toContentFile, suggestedPath, wordCount, readMinutes, type McpArticle,
} from '@/lib/mcp/format';

const article = (over: Partial<McpArticle> = {}): McpArticle => ({
  slug: 'how-to-brew',
  title: 'How to brew',
  body_md: 'Coffee is good.\n\n## Grind\n\nMedium.',
  meta_title: 'How to brew | Acme',
  meta_description: 'A short guide.',
  published_at: '2026-08-01T10:00:00.000Z',
  updated_at: null,
  cover_image_url: 'https://cdn.example.com/a.webp',
  cover_image_credit: 'Acme',
  author: 'Acme Team',
  genre: 'Guide',
  canonical_url: 'https://acme.com/blog/how-to-brew',
  post_id: '11111111-1111-1111-1111-111111111111',
  domain_id: '22222222-2222-2222-2222-222222222222',
  ...over,
});

describe('articleChecksum', () => {
  it('is short, hex, and stable for the same article', () => {
    expect(articleChecksum(article())).toMatch(/^[0-9a-f]{16}$/);
    expect(articleChecksum(article())).toBe(articleChecksum(article()));
  });

  it('changes when the BODY changes and every timestamp stays put', () => {
    // The whole reason it hashes the body. An article edited in the dashboard
    // keeps published_at and updated_at exactly as they were.
    const before = articleChecksum(article());
    const after = articleChecksum(article({ body_md: 'Coffee is good.\n\n## Grind\n\nFine.' }));
    expect(after).not.toBe(before);
  });

  it('changes when the canonical URL changes', () => {
    // set_article_base rewrites every canonical, and the canonical is written
    // into the file's frontmatter — so every file is genuinely stale and the
    // next plan_sync has to say so.
    expect(articleChecksum(article({ canonical_url: 'https://acme.com/writing/how-to-brew' })))
      .not.toBe(articleChecksum(article()));
  });

  it('changes when the byline or the genre changes', () => {
    expect(articleChecksum(article({ author: 'Jane Doe' }))).not.toBe(articleChecksum(article()));
    expect(articleChecksum(article({ genre: 'Opinion' }))).not.toBe(articleChecksum(article()));
  });

  it('cannot be fooled by shifting text across a field boundary', () => {
    // Without length-prefixing, ("ab","c") and ("a","bc") hash identically —
    // and an article whose title lost a word to its body would look unchanged.
    const a = articleChecksum(article({ title: 'ab', body_md: 'c' }));
    const b = articleChecksum(article({ title: 'a', body_md: 'bc' }));
    expect(a).not.toBe(b);
  });

  it('treats null and empty string as the same absence', () => {
    expect(articleChecksum(article({ cover_image_credit: null })))
      .toBe(articleChecksum(article({ cover_image_credit: '' })));
  });
});

describe('yamlFrontmatter', () => {
  it('quotes and escapes, so a title with punctuation still parses', () => {
    const out = yamlFrontmatter({ title: 'Coffee: the "good" kind' });
    expect(out).toContain('title: "Coffee: the \\"good\\" kind"');
  });

  it('escapes newlines rather than emitting a broken multi-line scalar', () => {
    expect(yamlFrontmatter({ description: 'one\ntwo' })).toContain('description: "one\\ntwo"');
  });

  it('drops empty values instead of writing keys with nothing in them', () => {
    // A template testing `if (frontmatter.image)` should not have to also test
    // for the empty string.
    const out = yamlFrontmatter({ title: 'x', image: null, credit: undefined, alt: '' });
    expect(out).not.toContain('image');
    expect(out).not.toContain('credit');
    expect(out).not.toContain('alt');
  });

  it('leaves numbers and booleans unquoted', () => {
    expect(yamlFrontmatter({ n: 3, ok: true })).toContain('n: 3');
    expect(yamlFrontmatter({ n: 3, ok: true })).toContain('ok: true');
  });

  it('opens and closes the block', () => {
    const lines = yamlFrontmatter({ title: 'x' }).split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[lines.length - 1]).toBe('---');
  });
});

describe('articleFrontmatter', () => {
  it('carries the two keys the next sync depends on', () => {
    const fm = articleFrontmatter(article());
    expect(fm.groveSlug).toBe('how-to-brew');
    expect(fm.groveChecksum).toBe(articleChecksum(article()));
  });

  it('never writes "AI" as the author — it takes what blog-genre resolved', () => {
    expect(articleFrontmatter(article()).author).toBe('Acme Team');
  });
});

describe('escapeMdx', () => {
  it('escapes the braces that would compile as a JS expression', () => {
    expect(escapeMdx('Send {"role": "user"} to the API.')).toBe('Send \\{"role": "user"\\} to the API.');
  });

  it('escapes a bare angle bracket in prose', () => {
    expect(escapeMdx('when a < b')).toBe('when a \\< b');
  });

  it('leaves fenced code exactly as written', () => {
    const src = ['Before {x}', '', '```js', 'const a = {b: 1}; if (a < 2) {}', '```', '', 'After {y}'].join('\n');
    const out = escapeMdx(src).split('\n');
    // Escaping inside a fence would put backslashes in the customer's code
    // samples — and a fence is not MDX-parsed anyway, so there is nothing to fix.
    expect(out[3]).toBe('const a = {b: 1}; if (a < 2) {}');
    expect(out[0]).toBe('Before \\{x\\}');
    expect(out[6]).toBe('After \\{y\\}');
  });

  it('leaves inline code spans alone', () => {
    expect(escapeMdx('Use `{ ...props }` here {x}')).toBe('Use `{ ...props }` here \\{x\\}');
  });

  it('handles tilde fences too', () => {
    const out = escapeMdx(['~~~', '{raw}', '~~~'].join('\n')).split('\n');
    expect(out[1]).toBe('{raw}');
  });
});

describe('toContentFile', () => {
  it('writes frontmatter then body, and escapes only for mdx', () => {
    const a = article({ body_md: 'A brace {here}.' });
    expect(toContentFile(a, 'mdx')).toContain('A brace \\{here\\}.');
    // md is byte-identical for layers that want the raw markdown.
    expect(toContentFile(a, 'md')).toContain('A brace {here}.');
  });

  it('starts with the frontmatter block and ends with a newline', () => {
    const file = toContentFile(article(), 'mdx');
    expect(file.startsWith('---\n')).toBe(true);
    expect(file.endsWith('\n')).toBe(true);
    expect(file).toContain('groveChecksum:');
  });
});

describe('suggestedPath', () => {
  it('uses the format\'s extension under a conventional directory', () => {
    expect(suggestedPath('how-to-brew', 'mdx')).toBe('content/blog/how-to-brew.mdx');
    expect(suggestedPath('how-to-brew', 'md', '/src/content/posts/')).toBe('src/content/posts/how-to-brew.md');
  });
});

describe('wordCount / readMinutes', () => {
  it('counts English words', () => {
    expect(wordCount('one two three four five')).toBe(5);
  });

  it('does not report one minute for a long Korean article', () => {
    // CJK has no spaces to split on, so a naive word count returns ~1 and
    // every Korean post claims a one-minute read.
    const korean = '커피를 내리는 방법에 대한 안내입니다'.repeat(80);
    expect(wordCount(korean)).toBeGreaterThan(400);
    expect(readMinutes(korean)).toBeGreaterThan(1);
  });

  it('floors at one minute', () => {
    expect(readMinutes('hi')).toBe(1);
    expect(readMinutes('')).toBe(1);
  });
});
