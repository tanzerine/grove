/**
 * Proof that the Korean landing renders Korean — and that the parts which are
 * meant to stay English still do.
 *
 * The unwrapped-string scanner proves every literal reaches `t`, and the
 * coverage test proves every key has a Korean entry. Neither proves the two
 * meet on screen: `locale` not threaded through a section, a `t` shadowed by a
 * loop variable, or copy read from a module-level table would all pass both
 * and still render English. The dashboard and the sign-up funnel each have
 * this same proof for that reason.
 *
 * The second half is the part with no equivalent elsewhere. This page mixes
 * translated chrome with a demo customer's own English content on purpose, so
 * "no English survives" would be the wrong assertion — the right one is that
 * the SPECIFIC English which survives is the demo content and nothing else.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/',
}));
// The dogfood section mounts the real embed via next/script; neither runs
// under renderToStaticMarkup and neither carries translatable copy.
vi.mock('next/script', () => ({ default: () => null }));

import Landing from '@/components/Landing';
import { SITE_NAV_LINKS } from '@/components/SiteNav';
import { KO } from '@/lib/i18n/ko';
import { PLANS } from '@/lib/plans';

const ko = renderToStaticMarkup(<Landing locale="ko" />);
const en = renderToStaticMarkup(<Landing locale="en" />);

/** React escapes text nodes, so a catalogue entry containing a quote or an
 *  ampersand never appears verbatim in the markup. */
const escaped = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

describe('the Korean landing renders Korean', () => {
  it('translates the hero — the first thing anyone reads', () => {
    expect(ko).toContain('도메인을 심고');
    expect(ko).toContain(escaped(KO['Connect your domain. Grove finds what your customers are searching for, writes the posts, and publishes them on your site — under your name, on a schedule you set.']));
    expect(ko).not.toContain('Plant your domain');
  });

  it('translates every section heading', () => {
    for (const head of [
      'Everything a content team does.',
      'Start free. Pay when it’s working.',
      'The honest FAQ.',
      'Our blog runs on Grove.',
      'Your next post starts here.',
    ]) {
      expect(ko, `heading: ${head}`).toContain(escaped(KO[head]));
      expect(en, `heading in English: ${head}`).toContain(escaped(head));
    }
  });

  it('translates all six FAQ questions and answers', () => {
    for (const q of [
      'Do I need WordPress or any hosting?',
      'Will the posts actually sound like me?',
      'Isn’t AI content bad for SEO now?',
      'Can I review posts before they go live?',
      'What’s the catch with the subscription?',
      'How fast is the first post?',
    ]) {
      expect(ko, `faq: ${q}`).toContain(escaped(KO[q]));
    }
  });

  it('translates the plan copy, which lives in a module-level table', () => {
    // lib/plans.ts is built once per process and holds English marked with
    // `msg`. If it ever became a `t` table, the first locale to load the
    // module would win for everyone and this would go red.
    for (const id of ['starter', 'growth', 'agency'] as const) {
      expect(ko, `blurb: ${id}`).toContain(escaped(KO[PLANS[id].blurb]));
      for (const f of PLANS[id].features) {
        expect(ko, `feature: ${f}`).toContain(escaped(KO[f]));
      }
      // Plan names are not translated — the invoice says "Starter".
      expect(ko).toContain(PLANS[id].name);
    }
  });

  it('translates the nav bar and shows the switcher', () => {
    for (const l of SITE_NAV_LINKS) {
      if (KO[l.label]) expect(ko, `nav: ${l.label}`).toContain(escaped(KO[l.label]));
    }
    // Each language offered under its own name, and the current one marked.
    expect(ko).toContain('한국어');
    expect(ko).toContain('>EN<');
    expect(ko).toMatch(/aria-current="true"[^>]*>한국어</);
    expect(en).toMatch(/aria-current="true"[^>]*>EN</);
  });

  it('marks the page as Korean for anything reading the DOM', () => {
    expect(ko).toContain('lang="ko"');
    expect(en).toContain('lang="en"');
  });

  it('translates the product mockups, which are most of the page by area', () => {
    for (const s of ['Search clicks', 'Publishing calendar', 'Content pipeline', 'Traffic sources', 'Openings Grove spotted']) {
      expect(ko, `mock chrome: ${s}`).toContain(escaped(KO[s]));
    }
  });
});

describe('what stays English, stays English', () => {
  it('keeps the demo customer’s own content untranslated', () => {
    // A Korean owner running an English site sees exactly this in the real
    // dashboard: Korean chrome around their own English articles.
    expect(ko).toContain('The Complete Guide to AI Onboarding Checklists');
    expect(ko).toContain('www.oveners.com');
    expect(ko).toContain('ai onboarding checklist');
  });

  it('keeps brand and platform names', () => {
    for (const n of ['Grove', 'LinkedIn', 'Zapier / n8n', 'RSS']) {
      expect(ko, `name: ${n}`).toContain(n);
    }
  });

  it('renders English at the English URL, with no Korean leaking in', () => {
    expect(en).toContain('Plant your domain');
    expect(en).not.toContain('도메인을 심고');
  });
});

describe('the {br} marker never reaches a reader', () => {
  it('is consumed as a line break in both languages', () => {
    expect(ko).not.toContain('{br}');
    expect(en).not.toContain('{br}');
    // And the break actually happened rather than being silently dropped:
    // `lines()` emits each half in its own span with the <br/> leading the
    // second, so the hero headline is two spans with a break between them.
    expect(en).toContain('<span>Plant your domain</span><span><br/>and watch your traffic grow.</span>');
    expect(ko).toContain('<span>도메인을 심고</span><span><br/>');
  });

  it('leaves no unsubstituted placeholder anywhere on the page', () => {
    // A translation that renamed a {placeholder} would print it literally.
    for (const html of [ko, en]) {
      expect(html.match(/\{[a-z]\w*\}/g) ?? []).toEqual([]);
    }
  });
});
