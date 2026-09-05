/**
 * Proof that the SIGN-UP FUNNEL actually renders in the visitor's language.
 *
 * The dashboard has the same proof (i18n-render.test.tsx) for the same reason:
 * a full Korean catalogue and a wrapped string still render English if the
 * component never sees a provider. That risk is higher here, not lower —
 * auth and onboarding have their own provider (components/LocaleProvider),
 * mounted from three separate entry points (/login, /signup, and the
 * onboarding layout), so "it works on the page I tested" is not proof.
 *
 * Only the surfaces that render something without an effect are rendered:
 * renderToStaticMarkup runs no effects, so /onboarding/about and
 * /onboarding/verify would render nothing but their loading line here. They
 * are covered by the unwrapped-string scan instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/signup',
}));
vi.mock('@/lib/supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/analytics/capture-client', () => ({ captureClient: () => {} }));

import { LocaleProvider, tNodes } from '@/components/LocaleProvider';
import AuthForm from '@/components/AuthForm';
import DomainStep from '@/app/onboarding/domain/page';
import IntentStep from '@/app/onboarding/intent/page';
import McpStep from '@/app/onboarding/mcp/McpStep';
import { INTERVIEW } from '@/lib/strategy/interview';
import { KO } from '@/lib/i18n/ko';
import type { UiLocale } from '@/lib/i18n';

function renderIn(locale: UiLocale, node: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(LocaleProvider, { locale, children: node }),
  );
}

/** React escapes text nodes, so a catalogue entry containing a quote or an
 *  ampersand — 'a named person ("I", …)' — never appears verbatim in the
 *  markup. Escape the expected string the same way before looking for it. */
const escaped = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

describe('the auth form renders in Korean', () => {
  const ko = renderIn('ko', React.createElement(AuthForm, {}));
  const en = renderIn('en', React.createElement(AuthForm, {}));

  it('translates the heading, the lede and both buttons', () => {
    for (const s of [
      'Sign in to Grove',
      'Enter your email to continue. New here? We’ll create your account automatically.',
      'Continue with Google',
      'One sign-in for everything. No account yet? Just continue — we’ll set it up.',
    ]) {
      expect(ko, `auth: ${s}`).toContain(KO[s]);
    }
  });

  it('translates the field placeholders, which a text-node scan would miss', () => {
    expect(ko).toContain(KO['Email']);
    expect(ko).toContain(KO['Password (8+ chars)']);
    expect(ko).not.toContain('placeholder="Email"');
  });

  it('leaves no English heading behind', () => {
    expect(ko).not.toContain('Sign in to Grove');
    expect(en).toContain('Sign in to Grove');
  });
});

describe('the domain step renders in Korean', () => {
  const ko = renderIn('ko', React.createElement(DomainStep, {}));

  it('translates the step marker, the title and the lede', () => {
    expect(ko).toContain(KO['Step 1 of 2']);
    expect(ko).toContain(KO['Enter your domain']);
    expect(ko).toContain(KO['One field. We’ll handle the rest. Use a domain you control — the next step verifies ownership via DNS or a meta tag.']);
  });
});

describe('the strategist interview renders in Korean', () => {
  // The one that matters most: INTERVIEW is a module-level table, evaluated
  // once per process. It holds English marked with `msg` and is translated at
  // the render site — if that ever regresses to a table built with `t`, the
  // first locale to load the module wins for everyone and this goes red.
  const ko = renderIn('ko', React.createElement(IntentStep, {}));

  it('translates every question prompt', () => {
    for (const q of INTERVIEW) {
      expect(ko, `prompt: ${q.prompt}`).toContain(escaped(KO[q.prompt]));
    }
  });

  it('translates the answer options while keeping English as the stored value', () => {
    const opts = INTERVIEW.flatMap((q) => q.options ?? []);
    expect(opts.length).toBeGreaterThan(20);
    for (const o of opts) expect(ko, `option: ${o}`).toContain(escaped(KO[o]));
    // The stored value is still the English one: it is the radio's `value`,
    // which is what reaches user_metadata and the strategist's prompt.
    expect(ko).not.toContain('>a named person');
  });

  it('translates the page chrome around them', () => {
    expect(ko).toContain(KO['Skip for now']);
    expect(ko).toContain(KO['Save and continue →']);
    expect(ko).toContain(KO['Pick up to 2.']);
  });
});

describe('the MCP offer renders in Korean', () => {
  const props = { endpoint: 'https://grove.test/api/mcp', hostname: 'acme.com' };
  const ko = renderIn('ko', React.createElement(McpStep, props));

  it('translates the eyebrow, the pitch and the step headings', () => {
    expect(ko).toContain(KO['Optional — for developers']);
    expect(ko).toContain(KO['1 · Make a key']);
    expect(ko).toContain(KO['Create my key']);
  });

  it('keeps the customer’s hostname inside the translated headline', () => {
    // The sentence is one key with a {host} placeholder precisely so Korean
    // can move it; what must survive is the hostname itself.
    expect(ko).toContain('acme.com');
    expect(ko).toContain('블로그가 저장소 안에 있나요?');
  });

  it('leaves the tool names alone — they name real apps', () => {
    expect(ko).toContain('Claude Code');
    expect(ko).toContain('integration_guide');
  });
});

describe('tNodes — a translated sentence with markup in it', () => {
  const render = (n: React.ReactNode) => renderToStaticMarkup(<>{n}</>);

  it('puts the slot where the TRANSLATION wants it, not where English did', () => {
    const en = render(tNodes('Verify ownership of {host}', { host: <b>acme.com</b> }));
    const ko = render(tNodes(KO['Verify ownership of {host}'], { host: <b>acme.com</b> }));
    expect(en).toBe('Verify ownership of <b>acme.com</b>');
    // Korean puts the object first — the whole reason this helper exists.
    expect(ko.indexOf('<b>')).toBeLessThan(ko.indexOf('소유권'));
  });

  it('fills several slots and leaves the surrounding text intact', () => {
    const out = render(tNodes('a {one} b {two} c', { one: <i>1</i>, two: <i>2</i> }));
    expect(out).toBe('a <i>1</i> b <i>2</i> c');
  });

  it('renders an unmatched placeholder literally rather than dropping it', () => {
    // Visible in review; a silently dropped {host} would ship a headline with
    // the customer's own domain missing from it.
    expect(render(tNodes('hello {nobody}', {}))).toBe('hello {nobody}');
  });

  it('handles a sentence with no placeholders at all', () => {
    expect(render(tNodes('just text', { host: <b>x</b> }))).toBe('just text');
  });
});
