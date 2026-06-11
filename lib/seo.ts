/**
 * Shared SEO helpers for the public blog surface (/b/*, rss, sitemap, robots).
 */

/** Absolute origin the hosted blogs live on, no trailing slash. */
export function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove.so').replace(/\/$/, '');
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!),
  );
}

// Crawlers, preview fetchers, and CLI clients. These render the page (and
// inflate `reads`) but are not readers — the strategy loop consumes `reads`,
// so bot hits would skew next month's plan toward whatever bots crawl most.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discordbot|slackbot|embedly|pinterest|linkedinbot|twitterbot|vkshare|w3c_validator|lighthouse|headlesschrome|python-requests|python-urllib|curl\/|wget\/|go-http-client|java\/|ahrefs|semrush|mj12|dotbot|petalbot|gptbot|claudebot|ccbot|bytespider|amazonbot|applebot|yandex|baiduspider|duckduckbot/i;

export function isBot(ua: string | null | undefined): boolean {
  return !!ua && BOT_RE.test(ua);
}

/**
 * Serialize an object for an inline <script type="application/ld+json">.
 * Escapes `<` so post titles containing "</script>" can't break out of the tag.
 */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
