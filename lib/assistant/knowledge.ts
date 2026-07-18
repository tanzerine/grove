/**
 * Product knowledge for the dashboard assistant — short, accurate how-to
 * sections the chat can answer setup questions from ("how do I set up the
 * canonical URL?"). Kept as data so answers never drift from a hallucinating
 * model: the LLM only ever paraphrases these sections, and when no
 * subscription is active the section text itself is the answer.
 *
 * `relevantKnowledge()` is a pure keyword scorer (unit-tested) so a chat
 * message only pulls the 1–2 sections it actually needs into the prompt.
 */

export type KnowledgeSection = {
  id: string;
  title: string;
  /** lowercase match terms — scored by count of hits in the message */
  keywords: string[];
  href: string;         // where in the dashboard this is done
  body: string;         // plain markdown-ish text, ~100 words max
};

export const KNOWLEDGE: KnowledgeSection[] = [
  {
    id: 'canonical-url',
    title: 'Canonical URL setup',
    keywords: ['canonical', 'rel=canonical', 'duplicate content', 'sitemap', 'rss', 'own domain', 'seo credit', '캐노니컬', '표준 url'],
    href: '/dashboard/embed',
    body: `To make your own domain the canonical home of every article:
1. Open Dashboard → Embed & SEO.
2. In "Canonical base", enter the URL where articles live on YOUR site (e.g. https://yoursite.com/blog) and save.
Once set, every rel=canonical tag, sitemap entry, RSS item, JSON-LD and social link points at your domain instead of the Grove-hosted blog — so your domain collects the SEO credit. Make sure that base actually serves the articles (via the #grove-blog embed or your own /blog/[slug] pages) before setting it.`,
  },
  {
    id: 'custom-hostname',
    title: 'Custom blog hostname (CNAME)',
    keywords: ['cname', 'custom hostname', 'custom domain', 'blog.', 'subdomain', 'dns', 'point my domain', '커스텀 도메인', '서브도메인'],
    href: '/dashboard/embed',
    body: `To serve the whole blog at your own subdomain (e.g. blog.acme.com) with zero code:
1. Open Dashboard → Embed & SEO and enter the hostname in "Custom blog hostname".
2. At your DNS provider, add a CNAME record pointing that subdomain at Grove.
The embed page shows a live status checklist (attach → DNS → serving) and re-verifies itself, so just follow it until every step is green. TLS is issued automatically once DNS propagates (can take up to an hour).`,
  },
  {
    id: 'embed',
    title: 'Embedding the blog on your site',
    keywords: ['embed', 'widget', 'snippet', 'grove-blog', 'script tag', 'add the blog', 'show posts on my site', '임베드', '위젯'],
    href: '/dashboard/embed',
    body: `Dashboard → Embed & SEO has copy-paste snippets:
- \`<div id="grove-blog"></div>\` + the script tag renders your full blog (list + articles) inside any page of your site.
- \`<div id="grove-widget"></div>\` renders a small teaser of recent posts.
Options via data attributes: \`data-article-base="/blog"\` links cards to your own article pages, \`data-accent\` sets the accent color, \`data-count\` caps how many posts show.`,
  },
  {
    id: 'search-console',
    title: 'Connecting Google Search Console',
    keywords: ['search console', 'gsc', 'impressions', 'google verification', 'connect google', 'search data', '서치콘솔', '서치 콘솔'],
    href: '/dashboard/analytics',
    body: `Dashboard → Analytics → "Connect Google Search Console" starts the Google sign-in. After connecting, Grove wires up (or creates) the property and syncs clicks, impressions, CTR and average position daily. This is also what feeds the monthly strategy review, so it's worth connecting early — impressions are the only pre-traffic signal a new blog has.`,
  },
  {
    id: 'ga4',
    title: 'Connecting Google Analytics (GA4)',
    keywords: ['ga4', 'google analytics', 'analytics property', 'sessions', '애널리틱스'],
    href: '/dashboard/analytics',
    body: `Grove's own first-party analytics work out of the box (reads, dwell, scroll, conversions — no third-party JS on your blog). If you also want whole-site Google Analytics numbers in the dashboard, connect GA4 from Dashboard → Analytics; Grove then queries your GA4 property live for the selected date range.`,
  },
  {
    id: 'autopilot',
    title: 'Autopilot vs review mode',
    keywords: ['autopilot', 'auto publish', 'auto-publish', 'review mode', 'approve', 'publish automatically', '자동 발행', '자동발행', '검수'],
    href: '/dashboard/pipeline',
    body: `Two publishing modes, toggled from the top nav:
- Autopilot ON: drafts that pass the quality gate publish on schedule without you.
- Autopilot OFF (review mode): finished drafts land in Pipeline → Review and wait for your approval.
Either way, drafts the AI manager flags with concerns always route to human review — they never auto-publish.`,
  },
  {
    id: 'schedule',
    title: 'How the publishing schedule works',
    keywords: ['schedule', 'publishing plan', 'cadence', 'posts per week', 'when publish', 'calendar', '발행 일정', '스케줄'],
    href: '/dashboard/calendar',
    body: `Each month the strategist builds a plan (goals → pillars → dated publishing slots) sized to your posts-per-week setting. The scheduler drafts each slot ahead of its date and publishes on the day. See the month at a glance in Dashboard → Calendar; steer it in plain language from Dashboard → Strategy ("add two more conversion posts", "drop the pricing pillar").`,
  },
  {
    id: 'social',
    title: 'Auto-posting to social',
    keywords: ['social', 'twitter', ' x ', 'linkedin', 'instagram', 'webhook', 'share', '소셜', '공유'],
    href: '/dashboard/connections',
    body: `Dashboard → Connections links X, LinkedIn or Instagram via OAuth; once connected, Grove composes and posts a share for each published article. No social account? Add an outbound webhook instead and Grove will POST each published article's link + summary to it (Zapier/Make/Slack-friendly).`,
  },
  {
    id: 'quality',
    title: 'Quality gate & scores',
    keywords: ['quality', 'score', 'manager', 'rubric', 'rejected', 'rewrite', '품질', '점수'],
    href: '/dashboard/pipeline',
    body: `Every draft is evaluated by an AI manager on a 0–100 rubric across strategic fit, marketing, craft and safety. Approved drafts proceed; weak ones get rewritten; drafts with concerns route to your review. Scores ≥70 read green, 40–69 amber, below 40 red — you'll see the rings on each post and the pipeline.`,
  },
];

/** Score sections by keyword hits and return the best few (empty if none). */
export function relevantKnowledge(message: string, max = 2): KnowledgeSection[] {
  const m = ` ${message.toLowerCase()} `;
  return KNOWLEDGE
    .map((s) => ({ s, hits: s.keywords.filter((k) => m.includes(k)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .map((x) => x.s);
}
