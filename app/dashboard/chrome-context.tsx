'use client';
import { createContext, useContext } from 'react';

export type ChromeDomain = { id: string; hostname: string; verified_at: string | null };

export type Chrome = {
  email: string | null;
  isAdmin: boolean;
  plan: string;
  activeHostname: string | null;
  domains: ChromeDomain[];
  activeId: string | null;
};

const Ctx = createContext<Chrome | null>(null);

export function ChromeProvider({ value, children }: { value: Chrome; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChrome(): Chrome {
  const c = useContext(Ctx);
  if (!c) {
    // Safe fallback so a stray render never throws.
    return { email: null, isAdmin: false, plan: 'Free', activeHostname: null, domains: [], activeId: null };
  }
  return c;
}
