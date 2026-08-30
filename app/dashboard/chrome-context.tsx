'use client';
import { createContext, useContext } from 'react';
import { type Onboarding, EMPTY_ONBOARDING } from '@/lib/onboarding/checklist';
import { type Activity, EMPTY_ACTIVITY } from '@/lib/notifications/feed';
import { type UiLocale } from '@/lib/i18n';

export type ChromeDomain = { id: string; hostname: string; verified_at: string | null };

export type Chrome = {
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  plan: string;
  /** Live subscription? Gates every cost-bearing action in the UI (backend
   *  still 402s independently). false for Free / lapsed accounts. */
  entitled: boolean;
  activeHostname: string | null;
  activeId: string | null;
  /** Autopilot state of the active domain — drives the nav-bar autopilot toggle. */
  activeAutoPublish: boolean;
  domains: ChromeDomain[];
  onboarding: Onboarding;
  activity: Activity;
  /** UI language of the person using grove — NOT the language their blog
   *  publishes in (that's domains.language). Resolved once in the layout and
   *  handed down, so every client component reads the same answer. */
  locale: UiLocale;
};

const Ctx = createContext<Chrome | null>(null);

export function ChromeProvider({ value, children }: { value: Chrome; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChrome(): Chrome {
  const c = useContext(Ctx);
  if (!c) {
    // Safe fallback so a stray render never throws.
    return { userId: null, email: null, isAdmin: false, plan: 'Free', entitled: false, activeHostname: null, activeId: null, activeAutoPublish: false, domains: [], onboarding: EMPTY_ONBOARDING, activity: EMPTY_ACTIVITY, locale: 'en' };
  }
  return c;
}
