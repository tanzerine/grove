/**
 * Hero brief for the strategy page — a short, deterministic statement of the
 * *current marketing strategy*, derived from the plan itself.
 *
 * Why it exists: the hero used to print `direction.month` verbatim, which is
 * the same long narrative the Planning-cadence card shows under "Monthly".
 * Two cards, one sentence. The hero now answers a different question — what
 * play is this month running — in one line, and leaves the narrative to the
 * cadence card.
 */
import type { Strategy, PostSlot, Pillar } from './build';
import { createT, type T } from '../i18n';

export type StrategyBrief = {
  /** One short line: the play this month is running. */
  headline: string;
  /** The shape of the month in stats: pillars · funnel mix. */
  summary: string;
  /** The strategist's own "vs last month" note, trimmed to one sentence. */
  note?: string;
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** First sentence of a note, clipped — keeps the hero to one breath. */
function firstSentence(text: string, max = 150): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return clip(m ? m[1] : t, max);
}

/** The pillar carrying the most slots — the month's lead bet. */
function leadPillar(pillars: Pillar[], plan: PostSlot[]): { title: string; posts: number } | null {
  if (!pillars.length || !plan.length) return null;
  const counts = new Map<string, number>();
  for (const slot of plan) counts.set(slot.pillar_id, (counts.get(slot.pillar_id) ?? 0) + 1);
  let best: { title: string; posts: number } | null = null;
  for (const p of pillars) {
    const posts = counts.get(p.id) ?? 0;
    if (posts > 0 && (!best || posts > best.posts)) best = { title: p.title, posts };
  }
  return best;
}

export function strategyBrief(strategy: Strategy, t: T = createT('en')): StrategyBrief {
  const plan = strategy.publishing_plan ?? [];
  const pillars = strategy.pillars ?? [];

  const editorial = plan.filter((s) => s.intent === 'editorial').length;
  const contextual = plan.filter((s) => s.intent === 'contextual').length;
  const conversion = plan.filter((s) => s.intent === 'conversion').length;

  const lead = leadPillar(pillars, plan);
  let headline: string;
  if (!plan.length) {
    headline = t('The plan for this month is still being drafted.');
  } else if (lead) {
    // The pillar title inside is plan CONTENT (already in the blog's language);
    // only the sentence around it is chrome, so only that goes through `t`.
    headline = conversion > 0
      ? t('Own {pillar} — {posts} posts, {conversion} built to convert.',
          { pillar: clip(lead.title, 48), posts: plan.length, conversion })
      : t('Own {pillar} — {posts} posts building search authority.',
          { pillar: clip(lead.title, 48), posts: plan.length });
  } else {
    headline = plan.length === 1
      ? t('Ship 1 post and prove the channel.')
      : t('Ship {n} posts and prove the channel.', { n: plan.length });
  }

  const mix = [
    editorial ? t('{n} top-funnel', { n: editorial }) : '',
    contextual ? t('{n} mid-funnel', { n: contextual }) : '',
    conversion ? t('{n} conversion', { n: conversion }) : '',
  ].filter(Boolean).join(' · ');
  const shape = [
    pillars.length ? (pillars.length === 1 ? t('1 pillar') : t('{n} pillars', { n: pillars.length })) : '',
    mix,
  ].filter(Boolean).join(' · ');

  const summary = shape || t('Pillars and slots land as soon as the strategist finishes planning.');
  const note = strategy.notes ? firstSentence(strategy.notes) : undefined;

  return note ? { headline, summary, note } : { headline, summary };
}
