import { SITE } from '@/lib/site';
import { appBase } from '@/lib/seo';
import { PLANS, PLAN_IDS } from '@/lib/plans';
import { jsonLdScript, organizationNode } from '@/lib/seo';

/**
 * Homepage JSON-LD: Organization + WebSite + SoftwareApplication. grove sells
 * "answer-engine-ready structured data" — it should ship its own so AI Overviews
 * and ChatGPT can identify and cite the product. Offers are pulled from the
 * plan catalogue (lib/plans) so pricing here can't drift from billing.
 */
export default function StructuredData() {
  const base = appBase();
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      // Same builder the customer blogs use (lib/seo organizationNode) — grove
      // is a customer of grove, and a second hand-written Organization literal
      // here is exactly how the three copies drifted apart in the first place.
      // No sameAs yet: grove's homepage links no profile of its own, and this
      // field is never filled by hand with a URL nobody verified.
      organizationNode({
        id: `${base}/#organization`,
        name: SITE.name,
        url: base,
        description: SITE.description,
      }),
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        name: SITE.name,
        url: base,
        publisher: { '@id': `${base}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${base}/#software`,
        name: SITE.name,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'SEO & Content Marketing',
        operatingSystem: 'Web',
        url: base,
        description: SITE.description,
        publisher: { '@id': `${base}/#organization` },
        offers: PLAN_IDS.map((id) => ({
          '@type': 'Offer',
          name: `${PLANS[id].name} plan`,
          price: PLANS[id].priceUsd,
          priceCurrency: 'USD',
          category: 'subscription',
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }}
    />
  );
}
