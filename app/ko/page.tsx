/**
 * The Korean landing.
 *
 * A real URL rather than a language negotiated at `/` — see
 * lib/landing-locale.ts for the reasoning, which comes down to this: grove
 * sells SEO, Googlebot crawls from US IPs sending `en`, and a header-varied
 * homepage would mean Korean copy that no Korean could find by searching.
 *
 * Everything else about the page is the English one. Same component, same
 * testimonials, same auth-aware nav — `locale` is the only difference, and the
 * copy comes from the catalogue.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Landing from '@/components/Landing';
import StructuredData from '@/components/StructuredData';
import { supabaseServer } from '@/lib/supabase/server';
import { publishedTestimonials } from '@/lib/feedback-store';
import { landingAlternates } from '@/lib/landing-locale';
import { translate } from '@/lib/i18n';
import { SITE } from '@/lib/site';

// The title and description are what a Korean searcher sees in the result —
// the most valuable strings on the page, and the two that would be silently
// left in English by translating only what renders.
export const metadata: Metadata = {
  // `absolute` bypasses the root layout's `%s · grove` template. The English
  // homepage sits on `title.default`, which the template never touches, so
  // without this the Korean landing would be the only page whose <title>
  // carries a redundant brand suffix — and it would eat the SERP's character
  // budget for the half of the title a searcher actually reads.
  title: { absolute: translate('ko', SITE.title) },
  description: translate('ko', SITE.description),
  alternates: { canonical: '/ko', languages: landingAlternates() },
  openGraph: {
    url: '/ko',
    locale: 'ko_KR',
    title: translate('ko', SITE.title),
    description: translate('ko', SITE.description),
  },
  twitter: {
    title: translate('ko', SITE.title),
    description: translate('ko', SITE.description),
  },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  if (sp.code) redirect(`/auth/callback?code=${sp.code}`);

  // Same fail-safe posture as `/`: a marketing page must never 500 over the
  // nav's logged-in state or a testimonial.
  let loggedIn = false;
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    loggedIn = !!user;
  } catch {
    // backend down or misconfigured — render the signed-out landing
  }

  const testimonials = await publishedTestimonials(6);

  return (
    <>
      <StructuredData />
      <Landing loggedIn={loggedIn} testimonials={testimonials} locale="ko" />
    </>
  );
}
