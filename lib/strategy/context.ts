/**
 * Agent context — the loop's working memory, kept as two small markdown docs
 * per domain (see migration 0017):
 *
 *   plan_md     — the active plan as a compact memo. Rebuilt from the Strategy
 *                 record whenever a plan is created or revised.
 *   progress_md — a rolling weekly log the Monday cron appends to, trimmed to
 *                 MAX_PROGRESS_ENTRIES so prompt cost stays flat forever.
 *
 * Every LLM step that needs "where are we and how is it going" reads these
 * instead of re-serializing full strategy/report JSON — a plan memo is
 * ~500 tokens where the raw JSON is several thousand. Pure functions only;
 * persistence lives in context-store.ts.
 */
import type { Strategy, PostSlot, KPI } from './build';

export const MAX_PROGRESS_ENTRIES = 12;   // ~3 months of weekly entries

const METRIC_LABEL: Record<KPI['metric'], string> = {
  views: 'reads',
  unique_sessions: 'sessions',
  median_dwell_sec: 'sec median dwell',
  scroll_completion_rate: '% read-through',
  outbound_to_product_rate: '% click-through to product',
  conversions: 'conversions',
  organic_share: '% from search',
  newsletter_signups: 'newsletter signups',
};

function kpiLabel(k: KPI): string {
  const pct = ['scroll_completion_rate', 'outbound_to_product_rate', 'organic_share'];
  return pct.includes(k.metric) ? `${k.target}${METRIC_LABEL[k.metric]}` : `${k.target} ${METRIC_LABEL[k.metric]}`;
}

const day = (iso?: string) => (iso ? iso.slice(5, 10) : '??-??');
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Render a Strategy as the compact plan memo (plan_md). */
export function composePlanMd(strategy: Strategy, opts: { hostname: string }): string {
  const s = strategy;
  const lines: string[] = [`# Plan — ${opts.hostname} — ${s.month}`];

  if (s.direction?.month) lines.push(`Heading: ${clip(s.direction.month, 200)}`);
  if (s.notes) lines.push(`Vs last month: ${clip(s.notes, 240)}`);

  if (s.goals?.length) {
    lines.push('', 'GOALS');
    for (const g of s.goals.slice(0, 4)) {
      const kpi = (s.kpis ?? []).find((k) => k.goal_id === g.id);
      lines.push(`- ${clip(g.title, 80)}${kpi ? ` → ${kpiLabel(kpi)}` : ''}`);
    }
  }

  if (s.pillars?.length) {
    lines.push('', 'PILLARS');
    for (const p of s.pillars.slice(0, 5)) {
      lines.push(`- ${clip(p.title, 60)} — ${clip(p.promise, 100)}`);
    }
  }

  const weeks = s.direction?.weeks ?? [];
  if (weeks.length) {
    lines.push('', 'WEEK BY WEEK');
    weeks.slice(0, 5).forEach((w, i) => lines.push(`- W${i + 1}: ${clip(w, 140)}`));
  }

  const plan = s.publishing_plan ?? [];
  if (plan.length) {
    lines.push('', `SLOTS (${plan.length})`);
    for (const slot of plan.slice(0, 40)) {
      const kw = slot.target_keyword ? ` (kw: ${clip(slot.target_keyword, 40)})` : '';
      lines.push(`- ${day(slot.publish_date)} [${slot.intent}] ${clip(slot.topic, 90)}${kw}`);
    }
  }

  return lines.join('\n');
}

/* ─────────────────────────── weekly progress log ────────────────────────── */

export type WeeklyProgressInput = {
  weekOf: string;              // ISO date of the Monday the entry covers back from
  published: number;
  planned: number;             // slots the plan wanted live in the same window
  reads: number;
  readsPrev: number;           // previous week, for the trend arrow
  conversions: number;
  organicShare: number;        // 0..1
  topPost?: { title: string; views: number } | null;
};

/** One compact log entry — two lines, numbers only, no adjectives. */
export function progressEntry(w: WeeklyProgressInput): string {
  const trend = w.readsPrev > 0
    ? ` (${w.reads >= w.readsPrev ? '+' : ''}${Math.round(((w.reads - w.readsPrev) / w.readsPrev) * 100)}% wow)`
    : w.reads > 0 ? ' (first reads)' : '';
  const lines = [
    `### Week of ${w.weekOf}`,
    `- shipped ${w.published}/${w.planned} planned · ${w.reads} reads${trend} · ${w.conversions} conversions · ${Math.round(w.organicShare * 100)}% from search`,
  ];
  if (w.topPost && w.topPost.views > 0) {
    lines.push(`- top: "${clip(w.topPost.title, 70)}" (${w.topPost.views} reads)`);
  }
  return lines.join('\n');
}

/** Append an entry to the rolling log, dropping the oldest past the cap. */
export function appendProgress(
  existing: string,
  entry: string,
  maxEntries = MAX_PROGRESS_ENTRIES,
): string {
  const parts = existing
    .split(/\n(?=### )/)
    .map((p) => p.trim())
    .filter((p) => p.startsWith('### '));
  parts.push(entry.trim());
  return parts.slice(-maxEntries).join('\n\n');
}

/* ─────────────── horizons — this month / this week / today ─────────────── */

export type Horizons = {
  month: { headline: string; detail: string };
  week: { headline: string; slots: { topic: string; date: string; intent: string }[] };
  today: { headline: string; detail: string };
};

function utcDate(iso: string): string { return iso.slice(0, 10); }

/** Monday 00:00 UTC of the week containing `now`. */
function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;           // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

/**
 * Derive the "where are we heading" answer the dashboard shows, from the plan
 * alone — no LLM call, so it's always available and always consistent with
 * the calendar. The strategist's `direction` narrative is used when present;
 * everything else is computed.
 */
export function horizons(strategy: Strategy, now: Date): Horizons {
  const s = strategy;
  const plan = [...(s.publishing_plan ?? [])].sort((a, b) =>
    (a.publish_date ?? '') < (b.publish_date ?? '') ? -1 : 1);

  // month
  const kpiBits = (s.kpis ?? []).slice(0, 3).map(kpiLabel).join(' · ');
  const month = {
    headline: s.direction?.month || s.goals?.[0]?.title || `Publish ${plan.length} posts`,
    detail: [plan.length ? `${plan.length} posts planned` : '', kpiBits].filter(Boolean).join(' · ') || 'Plan in progress',
  };

  // week — real calendar week (Mon–Sun, UTC) containing `now`
  const ws = weekStart(now);
  const we = new Date(ws.getTime() + 7 * 86400_000);
  const inWeek = plan.filter((sl) => {
    if (!sl.publish_date) return false;
    const t = new Date(sl.publish_date).getTime();
    return t >= ws.getTime() && t < we.getTime();
  });
  const weekIdx = Math.min(4, Math.max(1, Math.ceil(now.getUTCDate() / 7)));
  const weekNarrative = s.direction?.weeks?.[weekIdx - 1];
  const week = {
    headline: weekNarrative || (inWeek.length
      ? `${inWeek.length} post${inWeek.length === 1 ? '' : 's'} going live this week`
      : 'No publishes this week — compounding what’s already live'),
    slots: inWeek.slice(0, 5).map((sl) => ({
      topic: sl.topic, date: day(sl.publish_date), intent: sl.intent,
    })),
  };

  // today
  const todayStr = utcDate(now.toISOString());
  const todaySlot = plan.find((sl) => sl.publish_date && utcDate(sl.publish_date) === todayStr);
  const nextSlot = plan.find((sl) => sl.publish_date && utcDate(sl.publish_date) > todayStr);
  let today: Horizons['today'];
  if (todaySlot) {
    today = { headline: `Publishing today: ${clip(todaySlot.topic, 90)}`, detail: `${todaySlot.intent} piece — drafted, quality-checked, and shipped by the agent` };
  } else if (nextSlot) {
    const days = Math.max(1, Math.round((new Date(nextSlot.publish_date!).getTime() - new Date(todayStr).getTime()) / 86400_000));
    today = { headline: `Next up in ${days} day${days === 1 ? '' : 's'}: ${clip(nextSlot.topic, 90)}`, detail: 'Research and drafting run ahead of the publish date automatically' };
  } else {
    today = { headline: 'All planned posts are live', detail: 'Tracking reads and conversions — next month’s plan builds on what these posts prove' };
  }

  return { month, week, today };
}

/** Bounded context block for prompts: plan memo + as much recent progress as fits. */
export function contextForPrompt(planMd: string, progressMd: string, maxChars = 6000): string {
  const plan = planMd.slice(0, Math.min(planMd.length, maxChars));
  const room = maxChars - plan.length;
  const progress = room > 200 ? progressMd.slice(-room) : '';
  return [plan, progress && `\nPROGRESS LOG (weekly, newest last)\n${progress}`]
    .filter(Boolean).join('\n');
}
