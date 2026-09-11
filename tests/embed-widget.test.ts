/**
 * Where a `#grove-widget` card opens — `widgetHref()` in public/embed.js.
 *
 * The widget used to link every card at `{blogUrl}/{slug}`, a page that only
 * exists on a site that renders its own article route. On the default
 * install (and on grove's own landing) that was a 404 on every card, while
 * the no-JS fallback links underneath pointed at the right place. Widget
 * cards now follow the same precedence as the full blog: explicit base, then
 * the API's crawlable base, then the blog page's hash reader.
 *
 * embed.js has no DOM harness, so the pure function is pulled out of the
 * IIFE by source match — the same trick tests/embed-list.test.ts uses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(process.cwd(), 'public/embed.js'), 'utf8');

type WidgetHref = (slug: string, artBase: string | null, blogUrl: string) => string;

function extractWidgetHref(): WidgetHref {
  const m = SRC.match(/function widgetHref\(slug, artBase, blogUrl\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error('widgetHref() not found in embed.js');
  return new Function(`${m[0]}; return widgetHref;`)() as WidgetHref;
}

const widgetHref = extractWidgetHref();

describe('widgetHref', () => {
  it('links at {base}/{slug} when an article base is known', () => {
    expect(widgetHref('hello', 'https://trygroveai.com/b/trygroveai-com-o6hf', '/blog'))
      .toBe('https://trygroveai.com/b/trygroveai-com-o6hf/hello');
  });

  it('tolerates a trailing slash on the base', () => {
    expect(widgetHref('hello', 'https://blog.acme.com/', '/blog')).toBe('https://blog.acme.com/hello');
  });

  it('falls back to the blog page hash reader, never to {blogUrl}/{slug}', () => {
    // `/blog/hello` is a 404 on every site that mounts #grove-blog at /blog;
    // `/blog#grove/hello` is the reader that page already runs.
    expect(widgetHref('hello', null, '/blog')).toBe('/blog#grove/hello');
    expect(widgetHref('hello', null, '/blog/')).toBe('/blog#grove/hello');
    expect(widgetHref('hello', null, '/blog')).not.toBe('/blog/hello');
  });

  it('honours an explicit base over the fallback even when blogUrl is set', () => {
    expect(widgetHref('hello', '/articles', '/blog')).toBe('/articles/hello');
  });
});

describe('the widget resolves its base like the full blog does', () => {
  it('reads data-article-base and falls back to the API blog_base', () => {
    const w = SRC.slice(SRC.indexOf('function mountWidget('), SRC.indexOf('full blog mode'));
    expect(w).toContain("root.getAttribute('data-article-base')");
    expect(w).toContain('if (!artBase && d.blog_base) artBase = d.blog_base;');
    expect(w).toContain('widgetHref(p.slug, artBase, blogUrl)');
  });
});
