import { describe, it, expect } from 'vitest';
import { REPORTS, draftParams, getDraft } from '../lib/reports';
import { draftMarkdown, checkDraft, researchFor, fillInCount } from '../lib/reports/articles';
import { BANNED_PHRASES, phraseBoundaryRe } from '../lib/pipeline/quality-rules';

// Sample drafts reach a prospect as "what Grove would write for you". This
// holds each one to the real publish gate, so a draft that would fail it in
// production fails the build here instead.
const drafts = REPORTS.flatMap((r) => r.articles.filter((a) => a.draft).map((a) => ({ r, a })));

describe('sample drafts', () => {
  it('exist for the routes the report links to', () => {
    expect(drafts.length).toBeGreaterThan(0);
    for (const p of draftParams()) expect(getDraft(p.slug, p.article)).not.toBeNull();
    expect(getDraft(REPORTS[0].slug, 'nope')).toBeNull();
  });

  describe.each(drafts.map(({ r, a }) => [a.draft!.slug, r, a] as const))('%s', (_s, r, a) => {
    const md = draftMarkdown(a.draft!.file);

    it('has the report title as its one H1', () => {
      const h1s = md.split('\n').filter((l) => /^# /.test(l));
      expect(h1s).toEqual([`# ${a.title}`]);
    });

    it("passes grove's validator in comparison mode with zero issues", () => {
      const { validation, blocking } = checkDraft(md, { title: a.title, businessName: r.business, domain: r.domain });
      expect(blocking).toEqual([]);
      expect(validation.issues).toEqual([]);
    });

    it('cites only pages that are in its research corpus', () => {
      const corpus = new Set(researchFor(r.domain).map((s) => s.url));
      const own = `https://${r.domain}/`;
      const links = [...md.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
      for (const url of links) expect(corpus.has(url) || url.startsWith(own)).toBe(true);
    });

    it('leaves exactly one line for the owner instead of inventing experience', () => {
      expect(fillInCount(md)).toBe(1);
    });

    it('carries no banned phrase and at most two em dashes', () => {
      for (const p of BANNED_PHRASES) expect(phraseBoundaryRe(p).test(md)).toBe(false);
      expect((md.match(/—/g) ?? []).length).toBeLessThanOrEqual(2);
    });
  });
});
