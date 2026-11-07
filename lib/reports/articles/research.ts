/**
 * The research corpus behind the Krevaya sample articles — the same shape the
 * pipeline hands the writer (title + url + snippet) and the validator's
 * fact-grounding check (researchText). Every snippet restates what the
 * vendor's own page said when fetched on 2026-11-07; nothing here is
 * inferred. When a price changes, change it here and in the article together.
 */
export type ResearchSource = { title: string; url: string; snippet: string };

export const KREVAYA_RESEARCH: ResearchSource[] = [
  {
    title: 'Buffer pricing',
    url: 'https://buffer.com/pricing',
    snippet: 'Free: $0, up to 3 channels, 10 scheduled posts per channel at a time. Essentials: $6 per channel per month on monthly billing, $5 yearly. Team: $12 per channel per month, $10 yearly, unlimited team members, approval workflows. Volume pricing above 10 channels: 11–25 channels $4.',
  },
  {
    title: 'Hootsuite pricing',
    url: 'https://hootsuite.com/pricing',
    snippet: 'Standard: $99 per user per month billed annually, 10 social accounts. Professional: $199 per user. Advanced: $399 per user, review and approve content with your team. Enterprise: custom, advanced listening, custom compliance solutions, single sign-on. No free plan; 14-day free trial.',
  },
  {
    title: "What are Publer's plans and pricing?",
    url: 'https://publer.com/help/en/article/what-are-publers-plans-and-pricing-15h4yqh',
    snippet: 'Free forever: up to 3 social accounts excluding X/Twitter, 10 scheduled posts at a time per account. Professional starts at $5/month with 1 social account. Business starts at $10/month. Every 10th social account is free. Yearly billing 20% off. Updated 15/09/2026.',
  },
  {
    title: 'SocialBee pricing',
    url: 'https://socialbee.com/pricing',
    snippet: 'Bootstrap: $29/month, 5 social profiles, 1 user. Accelerate: $49/month, 10 profiles, 1 user. Pro: $99/month, 25 profiles, 3 users per workspace, 5 workspaces. 14-day free trial.',
  },
  {
    title: 'Metricool pricing',
    url: 'https://metricool.com/pricing/',
    snippet: 'Free: 1 brand, up to 20 scheduled posts per month. Starter: $25/month monthly or $20 annual, up to 5 brands. Advanced: $67/month for up to 15 brands.',
  },
  {
    title: 'Postiz pricing',
    url: 'https://postiz.com/pricing',
    snippet: 'Standard: $29/month, 5 channels, no team support. Team: $39/month, 10 channels, unlimited members. Pro: $49/month, 30 channels. Ultimate: $99/month, 100 channels. 7-day free trial. Hosted cloud plus open source, self-hosting available.',
  },
  {
    title: 'Later pricing',
    url: 'https://later.com/pricing-v3',
    snippet: 'Starter: $18.75 USD/month billed annually, 1 social set (8 profiles), 1 user, 30 posts per profile per month. Growth: $37.50/month, 2 social sets. Scale: $82.50/month. 14-day free trial.',
  },
  {
    title: 'Krevaya vs Buffer',
    url: 'https://krevaya.com/vs/buffer/',
    snippet: 'Krevaya Free: $0, 1 account, 5 posts per month. Plus: $29/month, 25 accounts, Studio and AI. Pro: $99/month. Access currently by invitation.',
  },
  {
    title: 'Krevaya for Claude Code',
    url: 'https://krevaya.com/claude-code/',
    snippet: 'Remote MCP server; drafts go to a review queue; only a connection with the Publish permission can approve and schedule; read-only connections cannot publish; approved posts publish even when Claude Code is closed. MCP included from Plus ($29/month).',
  },
  {
    title: 'Krevaya LinkedIn channel',
    url: 'https://krevaya.com/channels/linkedin/',
    snippet: 'Personal LinkedIn profiles only, no company pages yet, no video.',
  },
];

/** What validatePost's fact-grounding check reads, joined as generate.ts does. */
export function researchText(sources: ResearchSource[]): string {
  return sources.map((s) => `${s.title} ${s.snippet}`).join('\n');
}
