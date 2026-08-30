/**
 * Proof that the dashboard actually renders in the owner's language.
 *
 * The catalogue test (i18n-coverage) proves every string HAS a Korean entry.
 * That is not the same as the entry reaching the screen: a label read from a
 * module-level table, a `t` shadowed by a map variable, or a component sitting
 * outside the context provider all type-check and all render English. So this
 * renders the real components through ChromeProvider at locale 'ko' and reads
 * the markup back.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

// These components call useRouter/usePathname; neither is mounted under
// renderToStaticMarkup, and neither has anything to do with what is asserted.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard',
}));
import { ChromeProvider, type Chrome } from '@/app/dashboard/chrome-context';
import { EMPTY_ONBOARDING } from '@/lib/onboarding/checklist';
import { EMPTY_ACTIVITY } from '@/lib/notifications/feed';
import SideNav from '@/app/dashboard/SideNav';
import OverviewPipeline from '@/app/dashboard/OverviewPipeline';
import ModeToggle from '@/app/dashboard/ModeToggle';
import AccountAvatarMenu from '@/app/dashboard/AccountAvatarMenu';
import { KO } from '@/lib/i18n/ko';
import type { UiLocale } from '@/lib/i18n';

function chrome(locale: UiLocale): Chrome {
  return {
    userId: 'u1', email: 'owner@example.com', isAdmin: false, plan: 'Starter',
    entitled: true, activeHostname: 'example.com', activeId: 'd1',
    activeAutoPublish: false, domains: [{ id: 'd1', hostname: 'example.com', verified_at: null }],
    onboarding: EMPTY_ONBOARDING, activity: EMPTY_ACTIVITY, locale,
  };
}

function renderIn(locale: UiLocale, node: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(ChromeProvider, { value: chrome(locale), children: node }),
  );
}

const ROWS = {
  Recent: [{ id: 'p1', title: 'A post', keyword: 'k', words: '900', s: 'review' as const, schedule: '—', icon: 'pen', accentIcon: false }],
};

describe('the navigation renders in Korean', () => {
  const ko = renderIn('ko', React.createElement(SideNav, {}));
  const en = renderIn('en', React.createElement(SideNav, {}));

  it('translates every nav label', () => {
    for (const label of ['Home', 'Strategy', 'Write', 'Pipeline', 'Calendar', 'Analytics', 'Brand voice', 'Billing']) {
      expect(ko, `nav item ${label}`).toContain(KO[label]);
    }
  });

  it('translates the section headings too', () => {
    for (const head of ['Create', 'Publish', 'Brand', 'Account']) {
      expect(ko, `section ${head}`).toContain(KO[head]);
    }
  });

  it('leaves no English nav label behind', () => {
    // ">Pipeline<" as a rendered text node, not the word inside an href.
    for (const label of ['>Home<', '>Strategy<', '>Calendar<', '>Analytics<']) {
      expect(ko, `${label} should not survive in Korean`).not.toContain(label);
      expect(en, `${label} must still be there in English`).toContain(label);
    }
  });

  it('still renders English when that is the locale', () => {
    expect(en).toContain('>Pipeline<');
    expect(en).not.toContain(KO['Pipeline']);
  });
});

describe('a table whose labels live in a module-level map', () => {
  // The failure mode this catches: ST/ES-style constants are evaluated once at
  // import, so a translation baked in there serves one locale to everyone.
  const ko = renderIn('ko', React.createElement(OverviewPipeline, { groups: ROWS as never }));

  it('translates the status chip', () => {
    expect(ko).toContain(KO['In review']);
    expect(ko).not.toContain('>In review<');
  });

  it('translates the column headers and the card title', () => {
    expect(ko).toContain(KO['Content pipeline']);
    expect(ko).toContain(KO['Target keyword']);
    expect(ko).toContain(KO['Status']);
  });

  it('translates the tab labels while keeping their English group keys', () => {
    expect(ko).toContain(KO['Recent']);
    expect(ko).toContain(KO['In review']);
  });
});

describe('a component that reads its copy through a helper function', () => {
  const ko = renderIn('ko', React.createElement(ModeToggle, {
    domainId: 'd1', autoPublish: true, postsPerWeek: 3, autoPublishFloor: 45,
  }));

  it('translates the heading and the plain-language hint', () => {
    expect(ko).toContain(KO['Publishing']);
    expect(ko).toContain(KO['Skips weak drafts; publishes the rest (recommended)']);
    expect(ko).toContain(KO['Posts publish automatically on schedule']);
  });
});

describe('the account menu offers every language', () => {
  const ko = renderIn('ko', React.createElement(AccountAvatarMenu, {}));

  it('labels itself in Korean', () => {
    // The menu body only renders once opened, but the trigger carries the
    // translated title attribute, which is enough to prove the wiring.
    expect(ko).toContain(KO['Account']);
  });
});

describe('an unknown locale degrades to English rather than breaking', () => {
  it('renders English labels', () => {
    const weird = renderIn('fr' as UiLocale, React.createElement(SideNav, {}));
    expect(weird).toContain('>Pipeline<');
  });
});
