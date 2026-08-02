/**
 * embed.js writes into the HEAD of a page grove doesn't own. That's the most
 * dangerous thing the script does: a canonical left behind after the reader
 * closes tells Google the customer's /blog page is a duplicate of one article,
 * which is a worse outcome than never touching the head at all.
 *
 * The suite is `environment: 'node'`, so setHead/clearHead are lifted out of the
 * source and run against a minimal fake document — the restore path is exercised
 * for real rather than grepped for.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(path.join(process.cwd(), 'public/embed.js'), 'utf8');

/** Lift the head-injection block (both functions + their shared `_head`). */
function loadHeadApi(doc: unknown) {
  const start = SRC.indexOf('var _head = null;');
  const end = SRC.indexOf('/* ── first-party analytics');
  expect(start, 'head-injection block not found in embed.js').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = SRC.slice(start, end);
  const factory = new Function(
    'document',
    `${body}; return { setHead: setHead, clearHead: clearHead, current: function () { return _head; } };`,
  );
  return factory(doc) as {
    setHead: (c: string | null, j: unknown) => void;
    clearHead: () => void;
    current: () => unknown;
  };
}

type El = {
  tagName: string;
  textContent: string;
  type: string;
  parentNode: unknown;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
};

function fakeDoc(existingCanonical?: string) {
  const children: El[] = [];
  const make = (tagName: string): El => {
    const attrs: Record<string, string> = {};
    return {
      tagName, textContent: '', type: '', parentNode: null,
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
    };
  };
  const head = {
    appendChild(el: El) { el.parentNode = head; children.push(el); },
    removeChild(el: El) { const i = children.indexOf(el); if (i >= 0) children.splice(i, 1); el.parentNode = null; },
  };
  const doc = {
    head,
    createElement: make,
    querySelector(sel: string) {
      if (sel !== 'link[rel="canonical"]') return null;
      return children.find((c) => c.tagName === 'link' && c.getAttribute('rel') === 'canonical') ?? null;
    },
  };
  if (existingCanonical) {
    const l = make('link');
    l.setAttribute('rel', 'canonical');
    l.setAttribute('href', existingCanonical);
    head.appendChild(l);
  }
  return { doc, children };
}

const GRAPH = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Article' }] };

describe('embed.js head injection', () => {
  it('overrides an existing canonical and puts the original back', () => {
    const { doc, children } = fakeDoc('https://acme.com/blog');
    const api = loadHeadApi(doc);

    api.setHead('https://blog.acme.com/my-post', GRAPH);
    const link = children.find((c) => c.tagName === 'link')!;
    expect(link.getAttribute('href')).toBe('https://blog.acme.com/my-post');

    api.clearHead();
    expect(link.getAttribute('href')).toBe('https://acme.com/blog');
    // Restored, not duplicated: two canonicals disagreeing makes Google ignore both.
    expect(children.filter((c) => c.tagName === 'link')).toHaveLength(1);
  });

  it('removes the canonical it created when the page had none', () => {
    const { doc, children } = fakeDoc();
    const api = loadHeadApi(doc);

    api.setHead('https://blog.acme.com/my-post', null);
    expect(children.filter((c) => c.tagName === 'link')).toHaveLength(1);

    api.clearHead();
    // An orphan canonical pointing at one article is exactly the damage this
    // path exists to avoid — the list view must be left as it was found.
    expect(children.filter((c) => c.tagName === 'link')).toHaveLength(0);
  });

  it('adds and removes the Article JSON-LD', () => {
    const { doc, children } = fakeDoc('https://acme.com/blog');
    const api = loadHeadApi(doc);

    api.setHead('https://blog.acme.com/my-post', GRAPH);
    const ld = children.find((c) => c.tagName === 'script')!;
    expect(ld.type).toBe('application/ld+json');
    expect(JSON.parse(ld.textContent)['@graph']).toHaveLength(1);

    api.clearHead();
    expect(children.some((c) => c.tagName === 'script')).toBe(false);
  });

  it('re-opening an article does not stack tags', () => {
    const { doc, children } = fakeDoc('https://acme.com/blog');
    const api = loadHeadApi(doc);
    api.setHead('https://blog.acme.com/one', GRAPH);
    api.setHead('https://blog.acme.com/two', GRAPH);
    expect(children.filter((c) => c.tagName === 'script')).toHaveLength(1);
    expect(children.find((c) => c.tagName === 'link')!.getAttribute('href')).toBe('https://blog.acme.com/two');

    api.clearHead();
    // The ORIGINAL href must survive being overwritten twice.
    expect(children.find((c) => c.tagName === 'link')!.getAttribute('href')).toBe('https://acme.com/blog');
  });

  it('is a no-op when the API sent neither field (older cached responses)', () => {
    const { doc, children } = fakeDoc('https://acme.com/blog');
    const api = loadHeadApi(doc);
    api.setHead(null, null);
    expect(children.find((c) => c.tagName === 'link')!.getAttribute('href')).toBe('https://acme.com/blog');
    expect(api.current()).toBeNull();
  });
});

describe('embed.js wiring', () => {
  it('restores the head when the reader returns to the list', () => {
    const renderList = SRC.slice(SRC.indexOf('function renderList()'), SRC.indexOf('window.addEventListener(\'hashchange\''));
    expect(renderList).toContain('clearHead()');
  });

  it('defaults the card base to the domain’s crawlable base from the API', () => {
    // The whole point: an already-pasted snippet starts linking to indexable
    // URLs once its owner connects a subdomain, with no edit to their page.
    expect(SRC).toContain('if (!artBase && r.blog_base) artBase = r.blog_base;');
    expect(SRC).toContain('blogBase = d.blog_base');
  });

  it('still lets an explicit data-article-base win', () => {
    expect(SRC).toContain("var artBase = (root.getAttribute('data-article-base') || '').trim() || null;");
  });
});
