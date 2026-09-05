/**
 * Resolves the UI language once for every onboarding step.
 *
 * The steps are all client components (forms, polling, tabs), so each of them
 * would otherwise have to resolve a locale for itself — five chances to
 * disagree with each other inside a single flow. The layout does it once and
 * the provider carries it down, which is the same shape the dashboard uses.
 *
 * `getPublicUiLocale` rather than `getUiLocale` on purpose: onboarding is where
 * the owner decides what the SITE publishes in, and the flow must not switch
 * language underneath them when that row is written. See lib/i18n/server.ts.
 */
import { LocaleProvider } from '@/components/LocaleProvider';
import { getPublicUiLocale } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale={await getPublicUiLocale()}>{children}</LocaleProvider>;
}
