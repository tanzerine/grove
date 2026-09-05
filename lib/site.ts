/**
 * Marketing-site identity — the single source for the brand name, the
 * keyword-bearing title/description, and the buyer keywords. Imported by the
 * root metadata, the sitemap, the JSON-LD, and the OG image so they can never
 * drift apart. URL comes from lib/seo appBase() (NEXT_PUBLIC_APP_URL).
 */
import { msg } from './i18n';
export const SITE = {
  name: 'grove',
  /** The one-word brand tagline (kept from the original title, moved to a suffix). */
  tagline: 'content that keeps growing',
  /**
   * <title> default — leads with the category so the homepage can rank for what
   * buyers actually search, not the un-searched brand slogan it had before.
   *
   * `msg` because the title and description are the two highest-value strings
   * on the marketing site: they are what a searcher reads in the result, not
   * on the page. app/ko/page.tsx translates them for the Korean landing, and
   * without the marker the coverage test could not tell they needed a Korean
   * entry — the one pair of strings it would be worst to miss.
   */
  title: msg('grove — AI agent that writes & auto-publishes SEO blog posts'),
  /** ~155 chars, keyword-bearing, benefit-first. */
  description: msg(
    'grove is an AI marketing agent that researches the live SERP, writes blog posts in your voice, and auto-publishes them to your site — built to rank on Google and get cited by ChatGPT.'),
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
