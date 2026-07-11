import type { Metadata } from 'next';
import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Terms of Service — grove' };

export default function Page() {
  return (
    <LegalPage title="Terms of Service" updated="July 11, 2026">
      <LegalSection heading="The service">
        grove generates, quality-gates, publishes, and measures blog content for
        domains you control. Plans, prices, and monthly post quotas are listed on
        the pricing page and in your billing dashboard; the billing dashboard is
        authoritative.
      </LegalSection>
      <LegalSection heading="Your account and your domain">
        You must provide accurate account information and may only connect domains
        you own or are authorized to manage. Domain ownership is verified via DNS,
        meta tag, or a well-known file before grove treats a domain as yours.
      </LegalSection>
      <LegalSection heading="AI-generated content">
        Posts are drafted by AI from live research and are scored by an automated
        editor before publishing. They can still contain errors. You are
        responsible for reviewing content published under your domain — grove
        gives you a review queue and a publish bar for exactly this — and for
        ensuring published content complies with the laws that apply to you.
      </LegalSection>
      <LegalSection heading="Ownership">
        Content grove generates for your domain is yours. Cancelling your
        subscription does not revoke your rights to content already generated or
        published. grove retains ownership of the service, software, and templates.
      </LegalSection>
      <LegalSection heading="Acceptable use">
        No using grove to generate content that is unlawful, deceptive, infringing,
        or designed to spam search engines at scale across domains you do not
        operate. We may suspend accounts that abuse the service or attempt to
        disrupt it.
      </LegalSection>
      <LegalSection heading="Billing, cancellation, refunds">
        Subscriptions renew monthly or annually through Stripe and can be cancelled
        anytime from the billing page, effective at the end of the paid period. If
        something went wrong, you can request a refund from the billing page and a
        human reviews it.
      </LegalSection>
      <LegalSection heading="Disclaimers and liability">
        The service is provided “as is”. We do not guarantee search rankings,
        traffic, citations by AI assistants, or revenue outcomes. To the maximum
        extent permitted by law, grove's aggregate liability is limited to the
        fees you paid in the three months before the claim arose.
      </LegalSection>
      <LegalSection heading="Changes">
        We may update these terms; material changes will be announced in the
        dashboard or by email before they take effect. Continued use after that is
        acceptance.
      </LegalSection>
      <LegalSection heading="Contact">
        Questions about these terms: <a href="mailto:tylee1171@snu.ac.kr">tylee1171@snu.ac.kr</a>.
      </LegalSection>
    </LegalPage>
  );
}
