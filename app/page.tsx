import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Landing from '@/components/Landing';
import { groveBlogLinks } from '@/lib/grove-blog';
import { groveEmbedHost } from '@/components/GroveEmbed';
import StructuredData from '@/components/StructuredData';
import { supabaseServer } from '@/lib/supabase/server';
import { publishedTestimonials } from '@/lib/feedback-store';
import { landingAlternates } from '@/lib/landing-locale';

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
    // Declares the Korean landing at /ko as this page's counterpart, and
    // itself as the x-default. Without the pair Google treats the two as
    // near-duplicates and picks one; with it, each is served to the searcher
    // it was written for. See lib/landing-locale.ts for why the landing is
    // path-based when the rest of the product is not.
    languages: landingAlternates(),
  },
  openGraph: { url: '/', locale: 'en_US' },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  if (sp.code) redirect(`/auth/callback?code=${sp.code}`);

  // Reflect auth state in the nav so a logged-in visitor doesn't see the
  // signed-out CTA and assume they've been logged out. Middleware keeps the
  // session cookie fresh, so this read is display-only.
  //
  // Fail-safe: this is the public marketing page, so a missing env var or an
  // unreachable/paused auth backend must NOT 500 it. Treat any failure as
  // signed-out and still render the landing. (Same defense as middleware, #71.)
  let loggedIn = false;
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    loggedIn = !!user;
  } catch {
    // backend down or misconfigured — render the signed-out landing
  }

  // Real, consented quotes. `publishedTestimonials` swallows its own failures
  // and returns [] — the same fail-safe posture as the auth read above, because
  // a marketing page must never 500 over a decorative section.
  const testimonials = await publishedTestimonials(6);

  // Crawlable fallback for the blog widget. The homepage is the highest-
  // authority page on the domain, and it shipped zero links to any article —
  // see lib/grove-blog. Fail-safe like the reads above: empty on any failure.
  const { base: blogBase, entries: blogLinks } = await groveBlogLinks(groveEmbedHost(), 3);

  return (
    <>
      <StructuredData />
      <Landing loggedIn={loggedIn} testimonials={testimonials} locale="en" blogLinks={blogLinks} blogBase={blogBase} />
    </>
  );
}
