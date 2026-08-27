/**
 * Handing an article to a blog that already exists.
 *
 * The failure this file is mostly about: an import that looks like it worked
 * and breaks the customer's *build*. MDX reads `{` as JavaScript and `<` as
 * JSX, so prose a markdown renderer shows fine ("pass {} to reset", "under
 * < 200ms") takes their site down on the next deploy — and the article that
 * did it came from us. Same class of bug for YAML: a title with a colon in it
 * turns frontmatter into a nested mapping and the page renders untitled.
 */
import { describe, it, expect } from 'vitest';
import {
  bodyFor, formatPost, frontmatterFields, mdxSafe, toFrontmatter, yamlString,
} from '@/lib/mcp/format';
import type { ContentPost } from '@/lib/mcp/format';

const post = (over: Partial<ContentPost> = {}): ContentPost => ({
  id: 'p-1',
  slug: 'how-to-ship',
  title: 'How to ship',
  body_md: '# How to ship\n\nFirst paragraph.\n\n## Step one\n\nDo the thing.',
  meta_description: 'A short guide.',
  published_at: '2026-08-01T10:00:00Z',
  updated_at: null,
  cover_image_url: 'https://cdn.example.com/cover.png',
  cover_image_credit: 'Photo: Someone',
  author: 'Acme Team',
  genre: 'Guide',
  canonical_url: 'https://acme.com/blog/how-to-ship',
  ...over,
});

describe('yamlString', () => {
  it('quotes and escapes so no title can restructure the frontmatter', () => {
    expect(yamlString('Plain')).toBe('"Plain"');
    // The realistic breakers, in order of how often an LLM writes them.
    expect(yamlString('Ship faster: a guide')).toBe('"Ship faster: a guide"');
    expect(yamlString('The "best" way')).toBe('"The \\"best\\" way"');
    expect(yamlString('C:\\path')).toBe('"C:\\\\path"');
    expect(yamlString('line one\nline two')).toBe('"line one\\nline two"');
  });

  it('keeps values that YAML would otherwise coerce as strings', () => {
    // Bare `no` is false in YAML 1.1 and a bare `- x` starts a list.
    expect(yamlString('no')).toBe('"no"');
    expect(yamlString('- not a list item')).toBe('"- not a list item"');
    expect(yamlString('#not-a-comment')).toBe('"#not-a-comment"');
  });
});

describe('toFrontmatter', () => {
  it('emits a fenced block and omits empty fields entirely', () => {
    const fm = toFrontmatter({ title: 'T', description: null, tags: [], count: 3, draft: false });
    expect(fm.startsWith('---\n')).toBe(true);
    expect(fm.endsWith('\n---')).toBe(true);
    expect(fm).toContain('title: "T"');
    expect(fm).toContain('count: 3');
    expect(fm).toContain('draft: false');
    // `description: null` would render as the string "null" in a template that
    // doesn't check — dropping the key lets the template test for it.
    expect(fm).not.toContain('description');
    expect(fm).not.toContain('tags');
  });

  it('renames keys to whatever the layer already calls them', () => {
    const fm = toFrontmatter({ title: 'T', description: 'D' }, { description: 'excerpt' });
    expect(fm).toContain('excerpt: "D"');
    expect(fm).not.toContain('description:');
  });

  it('drops a key mapped to null', () => {
    const fm = toFrontmatter({ title: 'T', genre: 'Guide' }, { genre: null });
    expect(fm).not.toContain('genre');
    expect(fm).toContain('title: "T"');
  });

  it('emits arrays inline with every item quoted', () => {
    expect(toFrontmatter({ tags: ['seo', 'how to'] })).toContain('tags: ["seo", "how to"]');
  });
});

describe('mdxSafe', () => {
  it('escapes the two characters that break an MDX build', () => {
    const out = mdxSafe('Latency under < 200ms, and pass {} to reset.');
    expect(out).toContain('&lt; 200ms');
    expect(out).toContain('\\{\\}');
  });

  it('leaves fenced code alone — escaping there would corrupt the sample', () => {
    const md = 'Before {x}\n\n```js\nconst a = {b: 1};\nif (a < 2) {}\n```\n\nAfter {y}';
    const out = mdxSafe(md);
    expect(out).toContain('const a = {b: 1};');
    expect(out).toContain('if (a < 2) {}');
    expect(out).toContain('Before \\{x\\}');
    expect(out).toContain('After \\{y\\}');
  });

  it('leaves inline code alone too', () => {
    const out = mdxSafe('Use `{ cache: "no-store" }` here, not {this}.');
    expect(out).toContain('`{ cache: "no-store" }`');
    expect(out).toContain('\\{this\\}');
  });

  it('keeps real HTML tags, which MDX accepts', () => {
    const out = mdxSafe('An <a href="/x">link</a> and a <br /> stay.');
    expect(out).toContain('<a href="/x">');
    expect(out).toContain('</a>');
    expect(out).toContain('<br />');
  });
});

describe('bodyFor', () => {
  it('strips the leading H1 and the cover, because the template renders both from fields', () => {
    const p = post({ body_md: '# How to ship\n\n![cover](https://cdn.example.com/cover.png)\n\nBody text.' });
    const body = bodyFor(p);
    expect(body).not.toContain('# How to ship');
    expect(body).not.toContain('cdn.example.com/cover.png');
    expect(body).toContain('Body text.');
  });

  it('keeps an author\'s own leading image when it is not the cover', () => {
    const p = post({ body_md: '# T\n\n![diagram](https://cdn.example.com/other.png)\n\nBody.' });
    expect(bodyFor(p)).toContain('other.png');
  });
});

describe('frontmatterFields', () => {
  it('prefers the SEO title and carries the join key', () => {
    const f = frontmatterFields(post({ meta_title: 'How to ship — Acme' }));
    expect(f.title).toBe('How to ship — Acme');
    // grove_id is what makes a re-import an update instead of a duplicate.
    expect(f.grove_id).toBe('p-1');
    expect(f.canonical).toBe('https://acme.com/blog/how-to-ship');
  });

  it('falls back to the article title when there is no meta title', () => {
    expect(frontmatterFields(post({ meta_title: null })).title).toBe('How to ship');
  });
});

describe('formatPost', () => {
  it('defaults to markdown with frontmatter and a filename you can write', () => {
    const f = formatPost(post());
    expect(f.format).toBe('md');
    expect(f.filename).toBe('how-to-ship.md');
    expect(f.content.startsWith('---\n')).toBe(true);
    expect(f.content).toContain('slug: "how-to-ship"');
    expect(f.content).toContain('## Step one');
    // The title lives in frontmatter, so the body must not repeat it.
    expect(f.content).not.toContain('# How to ship');
  });

  it('escapes the body for mdx and names the file .mdx', () => {
    const f = formatPost(post({ body_md: '# T\n\nUse {braces} carefully.' }), { format: 'mdx' });
    expect(f.filename).toBe('how-to-ship.mdx');
    expect(f.content).toContain('\\{braces\\}');
  });

  it('does not escape the body for plain md, where the braces are literal', () => {
    const f = formatPost(post({ body_md: '# T\n\nUse {braces} carefully.' }), { format: 'md' });
    expect(f.content).toContain('{braces}');
  });

  it('renders html for a layer that stores html', () => {
    const f = formatPost(post(), { format: 'html', frontmatter: 'none' });
    expect(f.media_type).toBe('text/html');
    expect(f.content).toContain('<h2');
    expect(f.content.startsWith('---')).toBe(false);
  });

  it('returns fields only for json, with the body under body_md', () => {
    const f = formatPost(post(), { format: 'json' });
    const parsed = JSON.parse(f.content);
    expect(parsed.slug).toBe('how-to-ship');
    expect(parsed.grove_id).toBe('p-1');
    expect(parsed.body_md).toContain('## Step one');
    // Null fields are absent rather than null, same rule as the YAML head.
    expect('updated' in parsed).toBe(false);
  });

  it('applies field_map in json as well as in frontmatter', () => {
    // An importer written against `excerpt` should get `excerpt` whichever
    // format it asks for — otherwise the mapping silently only half-works.
    const opts = { field_map: { description: 'excerpt', genre: null } } as const;
    const json = JSON.parse(formatPost(post(), { ...opts, format: 'json' }).content);
    expect(json.excerpt).toBe('A short guide.');
    expect(json.description).toBeUndefined();
    expect(json.genre).toBeUndefined();

    const md = formatPost(post(), { ...opts, format: 'md' }).content;
    expect(md).toContain('excerpt: "A short guide."');
    expect(md).not.toContain('genre:');
  });

  it('omits frontmatter on request, for a CMS that stores fields separately', () => {
    const f = formatPost(post(), { frontmatter: 'none' });
    expect(f.content.startsWith('---')).toBe(false);
    expect(f.content.trim().startsWith('First paragraph.')).toBe(true);
  });

  it('falls back to markdown for an unknown format instead of throwing', () => {
    const f = formatPost(post(), { format: 'yaml' as any });
    expect(f.format).toBe('md');
  });
});
