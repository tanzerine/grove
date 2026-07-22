'use client';
import { createContext, useContext } from 'react';
import { type Onboarding, EMPTY_ONBOARDING } from '@/lib/onboarding/checklist';
import { type Activity, EMPTY_ACTIVITY } from '@/lib/notifications/feed';

export type ChromeDomain = { id: string; hostname: string; verified_at: string | null };

export type Chrome = {
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
};

const Ctx = createContext<Chrome | null>(null);

export function ChromeProvider({ value, children }: { value: Chrome; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChrome(): Chrome {
  const c = useContext(Ctx);
  if (!c) {
    // Safe fallback so a stray render never throws.
    return { email: null, isAdmin: false, plan: 'Free', entitled: false, activeHostname: null, activeId: null, activeAutoPublish: false, domains: [], onboarding: EMPTY_ONBOARDING, activity: EMPTY_ACTIVITY };
  }
  return c;
}
