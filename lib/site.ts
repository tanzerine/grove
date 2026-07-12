/**
 * Marketing-site identity — the single source for the brand name, the
 * keyword-bearing title/description, and the buyer keywords. Imported by the
 * root metadata, the sitemap, the JSON-LD, and the OG image so they can never
 * drift apart. URL comes from lib/seo appBase() (NEXT_PUBLIC_APP_URL).
 */
export const SITE = {
  name: 'grove',
  /** The one-word brand tagline (kept from the original title, moved to a suffix). */
  tagline: 'content that keeps growing',
  /** <title> default — leads with the category so the homepage can rank for what
   *  buyers actually search, not the un-searched brand slogan it had before. */
  title: 'grove — AI agent that writes & auto-publishes SEO blog posts',
  /** ~155 chars, keyword-bearing, benefit-first. */
  description:
    'grove is an AI marketing agent that researches the live SERP, writes blog posts in your voice, and auto-publishes them to your site — built to rank on Google and get cited by ChatGPT.',
  /** Buyer keywords for the meta keywords tag + content strategy. */
  keywords: [
    'AI SEO',
    'AI blog writer',
    'autoblog',
    'SEO content automation',
    'answer engine optimization',
    'AEO',
    'AI content marketing',
    'programmatic SEO',
    'auto-publish blog',
    'AI marketing agent',
  ],
} as const;
