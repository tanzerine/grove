import type { Metadata } from 'next';
import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  alternates: { canonical: '/privacy' },
};

export default function Page() {
  return (
    <LegalPage title="Privacy Policy" updated="July 11, 2026">
      <LegalSection heading="What grove is">
        grove is an agentic SEO blogging service: you connect a domain, and grove
        researches, writes, quality-checks, and publishes blog posts for it, then
        reports how they perform.
      </LegalSection>
      <LegalSection heading="What we collect">
        <ul>
          <li><strong>Account data</strong> — your email address and a password (or Google sign-in), handled by our auth provider, Supabase. We never see or store your password in plain text.</li>
          <li><strong>Site data</strong> — the domain you connect, public pages we crawl from it to learn your business and voice, and optionally a GitHub repository or Google Search Console property you connect.</li>
          <li><strong>Content</strong> — the drafts, posts, strategies, and evaluations grove generates for your domain.</li>
          <li><strong>First-party reading analytics</strong> — when someone reads a grove-hosted or grove-embedded blog, we record the event (page, referrer category, coarse user-agent class) ourselves. We do not run third-party analytics or advertising trackers on blog pages, and we do not build cross-site profiles of readers.</li>
          <li><strong>Billing data</strong> — payments are processed by Stripe. We store your plan and subscription status, never your card number.</li>
        </ul>
      </LegalSection>
      <LegalSection heading="How we use it">
        To operate the service: generating content in your brand voice, scoring it,
        publishing it, and reporting outcomes back to you. Aggregated, non-identifying
        usage may inform product improvements. We do not sell personal data.
      </LegalSection>
      <LegalSection heading="Processors we rely on">
        Vercel (hosting), Supabase (database, auth, storage), Stripe (payments),
        Replicate (AI model inference over your site profile and briefs), Tavily
        (web research), Resend (transactional email), Google APIs (only if you
        connect Search Console). Each receives only what it needs to do its job.
      </LegalSection>
      <LegalSection heading="Retention and deletion">
        Your content is yours. If you cancel, published posts remain wherever you
        published them. You can delete drafts and posts from the dashboard at any
        time, and you can request full account deletion by email — we will remove
        your account data within 30 days, except records we must keep for tax or
        accounting law.
      </LegalSection>
      <LegalSection heading="Contact">
        Privacy questions or deletion requests: <a href="mailto:tylee1171@snu.ac.kr">tylee1171@snu.ac.kr</a>.
      </LegalSection>
    </LegalPage>
  );
}
