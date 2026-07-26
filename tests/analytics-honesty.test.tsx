/**
 * The analytics report must never present invented numbers as the customer's
 * own performance.
 *
 * This regressed once already and shipped: illustrative figures were the
 * DEFAULT fallback for every empty section, so a brand-new account opened
 * "Performance report" to 48.2k organic clicks, ▲312%, and six article titles
 * it had never published — with the headline reading "your content earned
 * 48,210 clicks". The `sample` chip meant to label those cards was gated on
 * `anyLive`, so the fresh account that most needed the warning was the only
 * one that never saw it.
 *
 * Rendering to static markup (rather than asserting on props) is deliberate:
 * the bug lived in what the page *displayed*, so that is what's checked.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import AnalyticsDashboard from '@/app/dashboard/analytics/AnalyticsDashboard';
import type { AnalyticsData } from '@/lib/analytics/dashboard';

const NO_DATA: AnalyticsData = {
  live: null, series: null, articles: null, ranking: null,
  traffic: null, answers: null, funnel: null, ga: null, engagement: null,
};

/** Every fabricated FIGURE that used to greet a brand-new account. Naming an
 *  answer engine in explanatory copy ("ChatGPT … show up here as they cite
 *  you") is fine — it claims nothing. The invented *counts* are the lie, so
 *  those are what we probe for, anchored to their rendered text nodes. */
const INVENTED = [
  '48.2k', '48,210', '1.2M', '312%', '▲ 38%', '4.0%',
  'The SaaS founder', 'How to write for answer engines',
  'onboarding mistakes killing activation', 'Programmatic SEO without a dev team',
  '>186<', '>142<', '>73<', '88%', '67%', '34%',   // answer-engine citation counts
  '21.7k', '3,180', '742',                          // funnel
  'Positions 1–3', 'Positions 4–10',                // ranking bands
  '>58%<', '>24%<', '>11%<',                        // traffic-source split
];

function render(props: Partial<React.ComponentProps<typeof AnalyticsDashboard>> = {}) {
  return renderToStaticMarkup(
    React.createElement(AnalyticsDashboard, {
      hostname: 'brand-new-site.com',
      configured: true,
      connected: false,
      verified: false,
      data: NO_DATA,
      syncedAgo: 'just now',
      period: '30d' as const,
      ...props,
    }),
  );
}

describe('analytics dashboard — a brand-new account', () => {
  it('shows not one invented figure on first load', () => {
    const html = render();
    const leaked = INVENTED.filter((s) => html.includes(s));
    expect(leaked, `fabricated data leaked into a data-less report: ${leaked.join(', ')}`).toEqual([]);
  });

  it('never claims clicks the customer did not earn', () => {
    const html = render();
    expect(html).not.toMatch(/your content earned/i);
    expect(html).toMatch(/No performance data yet/i);
  });

  it('offers the sample view as an explicit, opt-in choice', () => {
    const html = render();
    expect(html).toMatch(/Preview with sample data/);
  });

  it('states plainly that nothing has been measured', () => {
    const html = render();
    expect(html).toMatch(/Nothing measured yet/);
  });
});

describe('analytics dashboard — an account with real data', () => {
  const LIVE: AnalyticsData = {
    ...NO_DATA,
    live: { clicks: 1234, impressions: 56789, ctr: 0.0217, avgPosition: 12.4, queryCount: 88 },
    series: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      clicks: 10 + i, impressions: 200 + i * 3, ctr: 0.02, position: 12,
    })) as AnalyticsData['series'],
  };

  it('renders the customer’s own numbers, not placeholders', () => {
    const html = render({ data: LIVE });
    expect(html).toMatch(/your content earned/i);
    expect(html).toContain('1.2k');          // 1234 clicks, compact
    expect(html).not.toMatch(/No performance data yet/i);
    expect(html).not.toMatch(/Preview with sample data/); // no toggle once live
  });

  it('still shows no fabricated figures alongside the real ones', () => {
    const html = render({ data: LIVE });
    const leaked = INVENTED.filter((s) => html.includes(s));
    expect(leaked, `fabricated data leaked into a LIVE report: ${leaked.join(', ')}`).toEqual([]);
  });
});
