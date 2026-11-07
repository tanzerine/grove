import type { ProspectReport } from './index';

/**
 * krevaya.com, researched 2026-11-06 with scripts/prospect-research.mjs
 * (raw JSON in scripts/out/krevaya/, not committed). Curated by hand:
 * the peer-gap and buyer-filter steps are not in the strategy pipeline yet.
 */
export const krevaya: ProspectReport = {
  slug: 'krevaya-958450',
  domain: 'krevaya.com',
  business: 'Krevaya',
  researchedOn: '2026-11-06',
  preparedBy: 'Tae, founder of Grove',
  currentRanks: [
    { keyword: 'blotato reviews', volume: 390, position: 52, path: '/vs/blotato/' },
    { keyword: 'blotato pricing', volume: 390, position: 62, path: '/vs/blotato/' },
    { keyword: 'krev ai', volume: 50, position: 69, path: '/features/' },
    { keyword: 'krev', volume: 140, position: 73, path: '/' },
  ],
  peers: [
    'postiz.com', 'typefully.com', 'ayrshare.com', 'upload-post.com', 'socialbee.com',
    'contentstudio.io', 'publer.com', 'blotato.com', 'metricool.com', 'buffer.com',
  ],
  articles: [
    {
      title: 'The best Buffer alternatives in 2026',
      target: { keyword: 'buffer alternatives', volume: 390, kd: 1 },
      also: [{ keyword: 'bufferapp alternatives', volume: 390, kd: 11 }],
      proof: { site: 'Blotato', position: 2, pageType: 'a list of alternatives' },
      why: 'Someone searching this is already leaving a scheduler. Your /vs/buffer/ page is one-on-one; the list format is what ranks.',
      draft: {
        slug: 'buffer-alternatives',
        file: 'krevaya-buffer-alternatives.md',
        description: 'Six Buffer alternatives compared on pricing model, free plan, approvals and automation, with prices checked November 2026.',
      },
    },
    {
      title: 'The best Hootsuite alternatives for small teams',
      target: { keyword: 'hootsuite alternative', volume: 720, kd: 20 },
      also: [{ keyword: 'free hootsuite alternative', volume: 210, kd: 16 }],
      why: 'Same template as the Buffer list, aimed at the bigger, pricier incumbent.',
      draft: {
        slug: 'hootsuite-alternatives',
        file: 'krevaya-hootsuite-alternatives.md',
        description: 'What Hootsuite costs a three-person team, and five alternatives that charge by plan instead of by seat.',
      },
    },
    {
      title: 'The best tools to schedule social media posts',
      target: { keyword: 'best tools to schedule social media posts', volume: 720, kd: 14 },
      why: 'Advertisers pay about $34 a click for this search, the highest buyer value we found.',
      draft: {
        slug: 'best-scheduling-tools',
        file: 'krevaya-best-scheduling-tools.md',
        description: 'Eight social media schedulers compared on price model, approvals and the catch, with a five-minute way to choose.',
      },
    },
    {
      title: 'LinkedIn MCP server: post to LinkedIn from Claude Code',
      target: { keyword: 'linkedin mcp server', volume: 480, kd: 0 },
      why: 'You have a page per AI agent, but people search by network. None of the ten tools we scanned is in the top 20 yet.',
    },
    {
      title: 'Instagram MCP: schedule Instagram posts from an AI agent',
      target: { keyword: 'instagram mcp', volume: 320, kd: 6 },
      proof: { site: 'Blotato', position: 18, pageType: 'one MCP page per network' },
      why: 'The second page in a per-network MCP set, a format only two small tools have started.',
    },
    {
      title: 'LinkedIn API pricing: what posting through the API costs',
      target: { keyword: 'linkedin api pricing', volume: 260, kd: 7 },
      also: [{ keyword: 'linkedin api cost', volume: 260, kd: 7 }],
      proof: { site: 'Blotato', position: 4, pageType: 'a blog post' },
      why: 'Developers pricing out the API are the people your API and MCP plan is for.',
    },
  ],
  retargets: [
    {
      path: '/tools/instagram-photo-resizer/',
      target: { keyword: 'instagram photo resizer', volume: 2900, kd: 7 },
      change: 'Already aimed right. It needs trust, not edits.',
      proof: { site: 'Postiz', position: 5, pageType: 'a free tool' },
    },
    {
      path: '/channels/tiktok/',
      target: { keyword: 'can you schedule posts on tiktok', volume: 2400, kd: 20 },
      change: 'Answer the question in the first sentence, then show how.',
    },
    {
      path: '/tools/instagram-line-break-generator/',
      target: { keyword: 'instagram line break', volume: 1900, kd: 0 },
      change: 'Already aimed right. It needs trust, not edits.',
      proof: { site: 'Postiz', position: 7, pageType: 'a free tool' },
    },
    {
      path: '/channels/linkedin/',
      target: { keyword: 'schedule linkedin posts', volume: 1600, kd: 5 },
      change: 'Close already. Answer "can you schedule posts on LinkedIn" (1,300/mo) in the first paragraph.',
    },
    {
      path: '/tools/x-character-counter/',
      target: { keyword: 'twitter character counter', volume: 1600, kd: 3 },
      change: 'Say "Twitter" in the title and H1. Most people still search the old name.',
      proof: { site: 'Postiz', position: 2, pageType: 'a free tool' },
    },
    {
      path: '/tools/linkedin-font-generator/',
      target: { keyword: 'linkedin bold text', volume: 1000, kd: 6 },
      change: 'Lead with "LinkedIn bold text". People don’t search "font generator" for LinkedIn.',
      proof: { site: 'Typefully', position: 7, pageType: 'a free tool' },
    },
  ],
  skips: [
    { keyword: 'link in bio', volume: 12100, kd: 32, why: 'People looking for Linktree or the meaning of the phrase.' },
    { keyword: 'what is an mcp server', volume: 9900, kd: 20, why: 'Developers learning MCP in general, not buying a social tool.' },
    { keyword: 'instagram carousel', volume: 8100, kd: 7, why: 'People making a carousel, usually in Canva.' },
    { keyword: 'jira mcp server', volume: 1900, kd: 19, why: 'Another product’s MCP server.' },
  ],
  trust: [
    'Check Search Console → Pages. If most pages say “Discovered, not indexed”, trust is the bottleneck.',
    'List the Krevaya MCP server on the MCP Registry, Smithery, Glama, mcp.so, PulseMCP and the awesome-mcp-servers lists.',
    'Submit the free tools to tool directories. Tools earn links far more easily than posts.',
    'Link from each guide to the matching tool or channel page, using the target phrase as the link text.',
  ],
  source: 'DataForSEO Labs, Google US, English. Volumes are monthly estimates and often undercount new phrases.',
};
